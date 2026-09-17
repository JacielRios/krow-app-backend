import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './shared/errors/api-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const corsOrigins = config.get<string>('CORS_ORIGINS', '*').trim();
  app.enableCors({
    origin:
      corsOrigins === '*'
        ? true
        : corsOrigins
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle('KROW API')
    .setDescription('API de viajes compartidos de KROW')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'v1/docs',
    app,
    SwaggerModule.createDocument(app, openApiConfig),
  );

  await app.listen(
    config.get<number>('PORT', 3000),
    config.get<string>('HOST', '0.0.0.0'),
  );
}
void bootstrap();
