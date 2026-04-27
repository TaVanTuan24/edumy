const User = require('../models/user');

class GoogleAuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GoogleAuthError';
    }
}

function isGoogleAuthConfigured(env = process.env) {
    return Boolean(
        String(env.GOOGLE_CLIENT_ID || '').trim()
        && String(env.GOOGLE_CLIENT_SECRET || '').trim()
        && String(env.GOOGLE_CALLBACK_URL || '').trim()
    );
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function getGoogleEmail(profile) {
    const emails = Array.isArray(profile && profile.emails) ? profile.emails : [];
    const primaryEmail = emails.find((entry) => entry && entry.value);
    return normalizeEmail(primaryEmail && primaryEmail.value);
}

function getGooglePhotoUrl(profile) {
    const photos = Array.isArray(profile && profile.photos) ? profile.photos : [];
    const photo = photos.find((entry) => entry && entry.value);
    return String(photo && photo.value || '').trim();
}

function getPreferredUsername(profile, email) {
    const displayName = String(profile && profile.displayName || '').trim();
    if (displayName) {
        return displayName.slice(0, 48);
    }

    const localPart = email.split('@')[0] || 'user';
    return localPart.slice(0, 48);
}

async function getUniqueUsername(UserModel, preferredUsername) {
    const baseUsername = String(preferredUsername || 'user').trim().slice(0, 48) || 'user';
    let candidate = baseUsername;
    let suffix = 1;

    while (await UserModel.findOne({ username: candidate })) {
        const suffixText = `-${suffix}`;
        const head = baseUsername.slice(0, Math.max(1, 48 - suffixText.length));
        candidate = `${head}${suffixText}`;
        suffix += 1;
    }

    return candidate;
}

function applyGoogleProfileFields(user, { googleId, email, photoUrl }) {
    user.googleId = googleId;

    if (!normalizeEmail(user.email) && email) {
        user.email = email;
    }

    if (!user.avatar || typeof user.avatar !== 'object') {
        user.avatar = { url: '', filename: '' };
    }

    if (!user.avatar.url && photoUrl) {
        user.avatar.url = photoUrl;
    }

    if (!user.avatar.filename) {
        user.avatar.filename = '';
    }
}

async function saveLinkedUser(user, { UserModel, googleId, email, photoUrl, logger }) {
    try {
        await user.save();
        return user;
    } catch (err) {
        if (!err || err.code !== 11000) {
            throw err;
        }

        const existingGoogleUser = await UserModel.findOne({ googleId });
        if (existingGoogleUser && String(existingGoogleUser._id) !== String(user._id)) {
            throw new GoogleAuthError('This Google account is already linked to another user.');
        }

        const existingEmailUser = email ? await UserModel.findOne({ email }) : null;
        if (existingEmailUser && String(existingEmailUser._id) !== String(user._id)) {
            if (!existingEmailUser.googleId) {
                applyGoogleProfileFields(existingEmailUser, { googleId, email, photoUrl });
                await existingEmailUser.save();
            }
            return existingEmailUser;
        }

        if (process.env.NODE_ENV !== 'production') {
            logger.warn('[google-auth] duplicate key while saving linked user', err);
        }

        throw new GoogleAuthError('Google login failed. Please try again.');
    }
}

async function resolveGoogleUser({
    profile,
    currentUserId = null,
    UserModel = User,
    logger = console
}) {
    const googleId = String(profile && profile.id || '').trim();
    const email = getGoogleEmail(profile);
    const photoUrl = getGooglePhotoUrl(profile);

    if (!googleId) {
        throw new GoogleAuthError('Google login failed. Please try again.');
    }

    if (!email) {
        throw new GoogleAuthError('Your Google account did not provide an email address. Please use another sign-in method.');
    }

    const existingGoogleUser = await UserModel.findOne({ googleId });

    if (currentUserId) {
        const currentUser = await UserModel.findById(currentUserId);
        if (!currentUser) {
            throw new GoogleAuthError('Your account could not be found. Please sign in again.');
        }

        if (existingGoogleUser && String(existingGoogleUser._id) !== String(currentUser._id)) {
            throw new GoogleAuthError('This Google account is already linked to another user.');
        }

        const currentEmail = normalizeEmail(currentUser.email);
        if (currentEmail && currentEmail !== email) {
            throw new GoogleAuthError('Sign in with a Google account that matches your current email address to link it.');
        }

        applyGoogleProfileFields(currentUser, { googleId, email, photoUrl });
        const savedUser = await saveLinkedUser(currentUser, { UserModel, googleId, email, photoUrl, logger });
        return {
            user: savedUser,
            isNewUser: false,
            wasLinked: true
        };
    }

    if (existingGoogleUser) {
        let needsSave = false;

        if (!normalizeEmail(existingGoogleUser.email) && email) {
            existingGoogleUser.email = email;
            needsSave = true;
        }

        if ((!existingGoogleUser.avatar || !existingGoogleUser.avatar.url) && photoUrl) {
            applyGoogleProfileFields(existingGoogleUser, { googleId, email, photoUrl });
            needsSave = true;
        }

        if (needsSave) {
            await saveLinkedUser(existingGoogleUser, { UserModel, googleId, email, photoUrl, logger });
        }

        return {
            user: existingGoogleUser,
            isNewUser: false,
            wasLinked: false
        };
    }

    const existingEmailUser = await UserModel.findOne({ email });
    if (existingEmailUser) {
        applyGoogleProfileFields(existingEmailUser, { googleId, email, photoUrl });
        const savedUser = await saveLinkedUser(existingEmailUser, { UserModel, googleId, email, photoUrl, logger });
        return {
            user: savedUser,
            isNewUser: false,
            wasLinked: true
        };
    }

    const username = await getUniqueUsername(UserModel, getPreferredUsername(profile, email));
    const newUser = new UserModel({
        username,
        email,
        googleId,
        avatar: {
            url: photoUrl || '',
            filename: ''
        }
    });

    try {
        await newUser.save();
        return {
            user: newUser,
            isNewUser: true,
            wasLinked: false
        };
    } catch (err) {
        if (!err || err.code !== 11000) {
            throw err;
        }

        if (process.env.NODE_ENV !== 'production') {
            logger.warn('[google-auth] duplicate key while creating user', err);
        }

        const concurrentGoogleUser = await UserModel.findOne({ googleId });
        if (concurrentGoogleUser) {
            return {
                user: concurrentGoogleUser,
                isNewUser: false,
                wasLinked: false
            };
        }

        const concurrentEmailUser = await UserModel.findOne({ email });
        if (concurrentEmailUser) {
            applyGoogleProfileFields(concurrentEmailUser, { googleId, email, photoUrl });
            const savedUser = await saveLinkedUser(concurrentEmailUser, { UserModel, googleId, email, photoUrl, logger });
            return {
                user: savedUser,
                isNewUser: false,
                wasLinked: true
            };
        }

        throw new GoogleAuthError('Google login failed. Please try again.');
    }
}

module.exports = {
    GoogleAuthError,
    isGoogleAuthConfigured,
    resolveGoogleUser
};
