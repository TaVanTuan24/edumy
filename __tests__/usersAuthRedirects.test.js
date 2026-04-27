const User = require('../models/user');
const users = require('../controllers/users');

function createResponse() {
  return {
    redirectedTo: '',
    redirect(path) {
      this.redirectedTo = path;
      return this;
    }
  };
}

describe('users auth redirects', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('login redirects to /courses by default', () => {
    const req = {
      flash: jest.fn(),
      session: {}
    };
    const res = createResponse();

    users.login(req, res);

    expect(req.flash).toHaveBeenCalledWith('success', 'Welcome back!');
    expect(res.redirectedTo).toBe('/courses');
  });

  test('login preserves a protected-page returnTo and clears it after use', () => {
    const req = {
      flash: jest.fn(),
      session: { returnTo: '/courses/123/discussions/new' }
    };
    const res = createResponse();

    users.login(req, res);

    expect(res.redirectedTo).toBe('/courses/123/discussions/new');
    expect(req.session.returnTo).toBeUndefined();
  });

  test('register auto-login redirects to /courses by default', async () => {
    const registeredUser = new User({ username: 'newuser', email: 'new@example.com' });
    const registerSpy = jest.spyOn(User, 'register').mockResolvedValue(registeredUser);
    const req = {
      body: {
        username: 'newuser',
        email: 'new@example.com',
        password: 'Password123!'
      },
      login: jest.fn((user, callback) => callback(null, user)),
      flash: jest.fn(),
      session: {}
    };
    const res = createResponse();

    await users.register(req, res);

    expect(registerSpy).toHaveBeenCalled();
    expect(req.login).toHaveBeenCalledWith(registeredUser, expect.any(Function));
    expect(req.flash).toHaveBeenCalledWith('success', 'Welcome to Edumy!');
    expect(res.redirectedTo).toBe('/courses');
  });

  test('googleAuthSuccess redirects to /courses by default', () => {
    const req = {
      flash: jest.fn(),
      session: { googleAuthIntent: 'login' }
    };
    const res = createResponse();

    users.googleAuthSuccess(req, res);

    expect(req.flash).toHaveBeenCalledWith('success', 'Welcome back!');
    expect(res.redirectedTo).toBe('/courses');
    expect(req.session.googleAuthIntent).toBeUndefined();
  });

  test('googleAuthSuccess preserves a protected-page returnTo and clears it after use', () => {
    const req = {
      flash: jest.fn(),
      session: {
        returnTo: '/courses/abc123',
        googleAuthIntent: 'login'
      }
    };
    const res = createResponse();

    users.googleAuthSuccess(req, res);

    expect(res.redirectedTo).toBe('/courses/abc123');
    expect(req.session.returnTo).toBeUndefined();
    expect(req.session.googleAuthIntent).toBeUndefined();
  });
});
