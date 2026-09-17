import { Module } from '@nestjs/common';
import { MatchingService } from './matching.service.js';

@Module({ providers: [MatchingService], exports: [MatchingService] })
export class MatchingModule {}
