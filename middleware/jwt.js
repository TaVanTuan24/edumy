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

async function attachJwtUser(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return next();

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
      .select('_id username email enrolledCourses enrolledCourseIds')
      .lean();

    if (!user) {
      throw new ExpressError('Unauthorized', 401);
    }

    req.user = user;
    req.jwtPayload = payload;
    req.authMethod = 'jwt';
    return next();
  } catch (err) {
    if (err instanceof ExpressError) return next(err);
    return next(new ExpressError('Unauthorized', 401));
  }
}

module.exports = {
  attachJwtUser
};