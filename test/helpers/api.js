'use strict';
require('./env');
const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();
const api = (token) => {
  const auth = (r) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
  const p = (path) => `/api/v1${path}`;
  return {
    get: (path) => auth(request(app).get(p(path))),
    post: (path, body) => auth(request(app).post(p(path))).send(body),
    put: (path, body) => auth(request(app).put(p(path))).send(body),
    patch: (path, body) => auth(request(app).patch(p(path))).send(body),
    delete: (path) => auth(request(app).delete(p(path))),
  };
};

let counter = 0;
async function registerUser(overrides = {}) {
  counter += 1;
  const body = { name: `User ${counter}`, email: `user${counter}-${Date.now()}@example.com`, password: 'correct-horse', ...overrides };
  const res = await api().post('/auth/register', body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, password: body.password, email: body.email, client: api(res.body.accessToken) };
}

async function categoryId(client, type, name) {
  const res = await client.get('/categories');
  return res.body.items.find((c) => c.type === type && (name ? c.name === name : !c.system)).id;
}

module.exports = { app, api, registerUser, categoryId };
