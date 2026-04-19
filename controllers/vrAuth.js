const crypto = require('crypto');
const VRLoginSession = require('../models/vrLoginSession');
const ExpressError = require('../utils/ExpressError');
const { createVRToken } = require('../middleware/isVRAuthenticated');

const CODE_TTL_SECONDS = 120;
const CODE_TTL_MS = CODE_TTL_SECONDS * 1000;
const CODE_PATTERN = /^\d{5}$/;
const ACTIVE_DEVICE_STATUSES = ['pending', 'approved'];

function getNow() {
  return new Date();
}

function buildExpiresAt(now = getNow()) {
  return new Date(now.getTime() + CODE_TTL_MS);
}

function normalizeDeviceId(value) {
  const deviceId = String(value || '').trim();

  if (!deviceId) {
    throw new ExpressError('deviceId is required', 400);
  }

  if (deviceId.length > 200) {
    throw new ExpressError('deviceId is too long', 400);
  }

  return deviceId;
}

function normalizeCode(value) {
  const code = String(value || '').trim();

  if (!CODE_PATTERN.test(code)) {
    throw new ExpressError('Code must be exactly 5 digits', 400);
  }

  return code;
}

async function expireStalePendingSessions(now = getNow()) {
  await VRLoginSession.updateMany(
    {
      status: 'pending',
      expiresAt: { $lte: now }
    },
    {
      $set: { status: 'expired' }
    }
  );
}

async function generateUniqueCode(now) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = String(crypto.randomInt(0, 100000)).padStart(5, '0');
    const existing = await VRLoginSession.exists({
      code: candidate,
      status: { $in: ACTIVE_DEVICE_STATUSES },
      expiresAt: { $gt: now }
    });

    if (!existing) {
      return candidate;
    }
  }

  throw new ExpressError('Unable to generate a pairing code right now', 503);
}

function getTerminalPollResponse(message) {
  return {
    success: false,
    status: 'expired',
    message
  };
}

module.exports.requestCode = async (req, res) => {
  const now = getNow();
  const deviceId = normalizeDeviceId(req.body && req.body.deviceId);

  await expireStalePendingSessions(now);

  await VRLoginSession.updateMany(
    {
      deviceId,
      status: { $in: ACTIVE_DEVICE_STATUSES }
    },
    {
      $set: {
        status: 'expired',
        expiresAt: now
      }
    }
  );

  const code = await generateUniqueCode(now);

  await VRLoginSession.create({
    code,
    deviceId,
    status: 'pending',
    expiresAt: buildExpiresAt(now)
  });

  return res.json({
    success: true,
    code,
    expiresIn: CODE_TTL_SECONDS
  });
};

module.exports.approveCode = async (req, res) => {
  const now = getNow();
  const code = normalizeCode(req.body && req.body.code);

  await expireStalePendingSessions(now);

  const session = await VRLoginSession.findOne({ code }).sort({ createdAt: -1 });

  if (!session) {
    throw new ExpressError('Pairing code not found', 404);
  }

  if (session.status === 'used') {
    throw new ExpressError('This pairing code has already been used', 409);
  }

  if (session.status === 'approved') {
    throw new ExpressError('This pairing code has already been approved', 409);
  }

  if (session.status === 'expired' || session.expiresAt <= now) {
    if (session.status !== 'expired') {
      session.status = 'expired';
      await session.save();
    }

    throw new ExpressError('Pairing code expired', 410);
  }

  const accessToken = createVRToken(req.user);

  const approvedSession = await VRLoginSession.findOneAndUpdate(
    {
      _id: session._id,
      status: 'pending'
    },
    {
      $set: {
        status: 'approved',
        user: req.user._id,
        approvedAt: now,
        accessToken
      }
    },
    { new: true }
  );

  if (!approvedSession) {
    throw new ExpressError('This pairing code can no longer be approved', 409);
  }

  return res.json({
    success: true,
    message: 'VR device paired successfully.'
  });
};

module.exports.pollCode = async (req, res) => {
  const now = getNow();
  const code = normalizeCode(req.params && req.params.code);
  const deviceId = normalizeDeviceId(req.query && req.query.deviceId);

  await expireStalePendingSessions(now);

  const approvedSession = await VRLoginSession.findOneAndUpdate(
    {
      code,
      deviceId,
      status: 'approved',
      expiresAt: { $gt: now }
    },
    {
      $set: { status: 'used' }
    },
    { new: false }
  ).populate('user', '_id username');

  if (approvedSession) {
    return res.json({
      success: true,
      status: 'approved',
      accessToken: approvedSession.accessToken,
      user: approvedSession.user
        ? {
            id: String(approvedSession.user._id),
            username: approvedSession.user.username || ''
          }
        : null
    });
  }

  const session = await VRLoginSession.findOne({
    code,
    deviceId
  }).sort({ createdAt: -1 });

  if (!session) {
    return res.status(404).json(getTerminalPollResponse('Pairing code expired'));
  }

  if (session.status === 'pending' && session.expiresAt > now) {
    return res.json({
      success: true,
      status: 'pending'
    });
  }

  if (session.status === 'pending' && session.expiresAt <= now) {
    session.status = 'expired';
    await session.save();
  }

  return res
    .status(410)
    .json(getTerminalPollResponse('Pairing code expired'));
};
