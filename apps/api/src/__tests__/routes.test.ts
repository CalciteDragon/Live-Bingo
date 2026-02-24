import { describe, it, expect } from 'vitest';
import { matchRouter } from '../routes/index.js';

describe('matchRouter', () => {
  it('is importable', () => {
    expect(matchRouter).toBeDefined();
  });

  it('has POST / handler', () => {
    const hasPost = matchRouter.stack.some(
      (layer) => layer.route?.path === '/' && (layer.route as any).methods['post'],
    );
    expect(hasPost).toBe(true);
  });

  it('has POST /:id/join handler', () => {
    const hasJoin = matchRouter.stack.some(
      (layer) => layer.route?.path === '/:id/join' && (layer.route as any).methods['post'],
    );
    expect(hasJoin).toBe(true);
  });

  it('has GET /:id handler', () => {
    const hasGet = matchRouter.stack.some(
      (layer) => layer.route?.path === '/:id' && (layer.route as any).methods['get'],
    );
    expect(hasGet).toBe(true);
  });
});
