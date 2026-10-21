import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { PilotDatabase } from './modules/pilot/pilot.database.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should report an available service', () => {
      expect(appController.health()).toMatchObject({
        status: 'ok',
        service: 'krow-api',
      });
    });
  });
  it('does not accept traffic when the pilot database prerequisites fail', async () => {
    const controller = new AppController({
      enabled: true,
      query: () => Promise.resolve([{ ready: false }]),
    } as unknown as PilotDatabase);
    await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
  });
});
