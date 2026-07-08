const jwt = require('jsonwebtoken');
const User = require('../models/user');
const ExpressError = require('../utils/ExpressError');
const { getJwtSecret } = require('../utils/jwtSecret');

function getBearerToken(req) {
  const authHeader = req.get('Authorization') || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token.trim();
}

function isStreamApiRequest(req) {
  const url = String((req && (req.originalUrl || req.url)) || '');
  return url.includes('/api/vr/stream/');
}

function sendUnauthorized(req, res) {
  if (isStreamApiRequest(req)) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized'
      }
    });
  }

  return res.status(401).json({
    success: false,
    message: 'Unauthorized'
  });
}

function createVRToken(user) {
  const secret = getJwtSecret();
  if (!secret) {
    throw new ExpressError('JWT secret is not configured', 500);
  }

  const payload = {
    userId: String(user._id),
    email: user.email || '',
    role: user.role || null
  };

  return jwt.sign(payload, secret, {
    expiresIn: '30d'
  });
}

async function isVRAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user._id) {
    req.authMethod = 'session';
    return next();
  }

  const token = getBearerToken(req);
  if (!token) {
    return sendUnauthorized(req, res);
  }

  const secret = getJwtSecret();
  if (!secret) {
    return next(new ExpressError('JWT secret is not configured', 500));
  }

  try {
    const payload = jwt.verify(token, secret);
    const userId = payload && (payload.userId || payload.id || payload.sub);

    if (!userId) {
      throw new ExpressError('Invalid token payload', 401);
    }

    const user = await User.findById(userId)
      .select('_id username email enrolledCourses enrolledCourseIds');

    if (!user) {
      return sendUnauthorized(req, res);
    }

    req.user = user;
    req.jwtPayload = payload;
    req.authMethod = 'jwt';
    return next();
  } catch {
    return sendUnauthorized(req, res);
  }
}

module.exports = {
  isVRAuthenticated,
  createVRToken
};
