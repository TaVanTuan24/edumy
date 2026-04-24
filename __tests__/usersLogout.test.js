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

describe('users logout handlers', () => {
  test('redirectLogout sends authenticated users back home with guidance', () => {
    const req = {
      isAuthenticated: () => true,
      flash: jest.fn()
    };
    const res = createResponse();

    users.redirectLogout(req, res);

    expect(req.flash).toHaveBeenCalledWith('error', 'Please use the logout button to sign out safely.');
    expect(res.redirectedTo).toBe('/');
  });

  test('logout signs out authenticated users and redirects home', () => {
    const req = {
      isAuthenticated: () => true,
      logout: jest.fn((callback) => callback()),
      flash: jest.fn()
    };
    const res = createResponse();
    const next = jest.fn();

    users.logout(req, res, next);

    expect(req.logout).toHaveBeenCalled();
    expect(req.flash).toHaveBeenCalledWith('success', 'Goodbye!');
    expect(res.redirectedTo).toBe('/');
    expect(next).not.toHaveBeenCalled();
  });

  test('logout short-circuits for unauthenticated users', () => {
    const req = {
      isAuthenticated: () => false,
      logout: jest.fn(),
      flash: jest.fn()
    };
    const res = createResponse();
    const next = jest.fn();

    users.logout(req, res, next);

    expect(req.logout).not.toHaveBeenCalled();
    expect(req.flash).toHaveBeenCalledWith('error', 'You are already signed out.');
    expect(res.redirectedTo).toBe('/');
    expect(next).not.toHaveBeenCalled();
  });
});
