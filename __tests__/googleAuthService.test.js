const {
  GoogleAuthError,
  resolveGoogleUser
} = require('../services/googleAuthService');

function createProfile(overrides = {}) {
  return {
    id: 'google-123',
    displayName: 'Taylor Student',
    emails: [{ value: 'student@example.com' }],
    photos: [{ value: 'https://example.com/avatar.png' }],
    ...overrides
  };
}

function createUser(doc = {}) {
  return {
    _id: doc._id || `user-${Math.random().toString(36).slice(2, 10)}`,
    username: doc.username || '',
    email: doc.email || '',
    googleId: doc.googleId,
    avatar: doc.avatar || { url: '', filename: '' },
    role: doc.role || undefined,
    save: jest.fn(async function save() {
      return this;
    })
  };
}

function createUserModel(seedUsers = []) {
  const users = [...seedUsers];

  function match(user, query) {
    return Object.entries(query).every(([key, value]) => user[key] === value);
  }

  function UserModel(doc) {
    const user = createUser(doc);
    user.save = jest.fn(async function save() {
      const existingIndex = users.findIndex((entry) => String(entry._id) === String(user._id));
      if (existingIndex === -1) {
        users.push(user);
      } else {
        users[existingIndex] = user;
      }
      return user;
    });
    return user;
  }

  UserModel.findOne = jest.fn(async (query) => users.find((user) => match(user, query)) || null);
  UserModel.findById = jest.fn(async (id) => users.find((user) => String(user._id) === String(id)) || null);
  UserModel.__users = users;

  return UserModel;
}

describe('googleAuthService', () => {
  test('links googleId to an existing local account with the same email', async () => {
    const existingUser = createUser({
      _id: 'local-1',
      username: 'Local Learner',
      email: 'student@example.com',
      role: 'admin'
    });
    const UserModel = createUserModel([existingUser]);

    const result = await resolveGoogleUser({
      profile: createProfile(),
      UserModel,
      logger: console
    });

    expect(result.user).toBe(existingUser);
    expect(result.wasLinked).toBe(true);
    expect(existingUser.googleId).toBe('google-123');
    expect(existingUser.role).toBe('admin');
    expect(existingUser.save).toHaveBeenCalled();
  });

  test('creates a new user when no local or google account exists', async () => {
    const UserModel = createUserModel([]);

    const result = await resolveGoogleUser({
      profile: createProfile(),
      UserModel,
      logger: console
    });

    expect(result.isNewUser).toBe(true);
    expect(result.user.email).toBe('student@example.com');
    expect(result.user.googleId).toBe('google-123');
    expect(result.user.avatar.url).toBe('https://example.com/avatar.png');
    expect(result.user.username).toBe('Taylor Student');
    expect(UserModel.__users).toHaveLength(1);
  });

  test('links a logged-in user when the google email matches', async () => {
    const currentUser = createUser({
      _id: 'current-1',
      username: 'Existing User',
      email: 'student@example.com'
    });
    const UserModel = createUserModel([currentUser]);

    const result = await resolveGoogleUser({
      profile: createProfile(),
      currentUserId: 'current-1',
      UserModel,
      logger: console
    });

    expect(result.user).toBe(currentUser);
    expect(result.wasLinked).toBe(true);
    expect(currentUser.googleId).toBe('google-123');
  });

  test('rejects linking a logged-in user when the google email does not match', async () => {
    const currentUser = createUser({
      _id: 'current-1',
      username: 'Existing User',
      email: 'different@example.com'
    });
    const UserModel = createUserModel([currentUser]);

    await expect(resolveGoogleUser({
      profile: createProfile(),
      currentUserId: 'current-1',
      UserModel,
      logger: console
    })).rejects.toBeInstanceOf(GoogleAuthError);
  });

  test('rejects profiles without a usable email address', async () => {
    const UserModel = createUserModel([]);

    await expect(resolveGoogleUser({
      profile: createProfile({ emails: [] }),
      UserModel,
      logger: console
    })).rejects.toThrow('Your Google account did not provide an email address.');
  });
});
