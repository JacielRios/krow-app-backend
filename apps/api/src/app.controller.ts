import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class AppController {
  @Get()
  @ApiOperation({ summary: 'Comprueba que la API está disponible' })
  health() {
    return {
      status: 'ok',
      service: 'krow-api',
      timestamp: new Date().toISOString(),
    };
  }
}
