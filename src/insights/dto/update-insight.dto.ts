import { PartialType } from '@nestjs/swagger';
import { CreateInsightDto } from './create-insight.dto';

export class UpdateInsightDto extends PartialType(CreateInsightDto) {}
