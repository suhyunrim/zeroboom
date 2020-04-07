const {
  create,
  join,
  invite,
  exit,
  kick,
  remove,
  expire,
} = require('../../src/services/party');

describe('', () => {
  test('', async () => {
    expect(await create('name', 'user', 'time')).toMatchObject({
      name: 'name',
      user: 'user',
      time: 'time',
    });
  });
  test('', async () => {
    expect(await join('name', 'user')).toMatchObject({
      name: 'name',
      user: 'user',
    });
  });
  test('', async () => {
    expect(await invite('name', 'user', 'guest')).toMatchObject({
      name: 'name',
      user: 'user',
      guest: 'guest',
    });
  });
  test('', async () => {
    expect(await exit('name', 'user')).toMatchObject({
      name: 'name',
      user: 'user',
    });
  });
  test('', async () => {
    expect(await kick('name', 'user')).toMatchObject({
      name: 'name',
      user: 'user',
    });
  });
  test('', async () => {
    expect(await remove('name', 'user', 'guest')).toMatchObject({
      name: 'name',
      user: 'user',
      guest: 'guest',
    });
  });
  test('', async () => {
    expect(await expire()).toMatchObject({});
  });
});
