const jwt = require('jsonwebtoken');
const User = require('../models/user');
const ExpressError = require('../utils/ExpressError');

function getBearerToken(req) {
  const authHeader = req.get('Authorization') || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token.trim();
}

function getJwtSecret() {
  return process.env.JWT_SECRET || process.env.SESSION_SECRET || 'mysceret';
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
    return res.status(401).json({
      success: false,
      message: 'Unauthorized'
    });
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
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    req.user = user;
    req.jwtPayload = payload;
    req.authMethod = 'jwt';
    return next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized'
    });
  }
}

module.exports = {
  isVRAuthenticated,
  createVRToken
};