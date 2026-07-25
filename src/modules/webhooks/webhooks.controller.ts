import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { WebhooksService } from './webhooks.service.js';
import { CreateWebhookDto } from './dto/create-webhook.dto.js';
import { UpdateWebhookDto } from './dto/update-webhook.dto.js';
import { WebhookResponseDto } from './dto/webhook-response.dto.js';

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('webhooks')
@UseGuards(ThrottlerGuard, JwtAuthGuard)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Register a webhook endpoint' })
  @ApiResponse({
    status: 201,
    description: 'Webhook registered successfully',
    type: WebhookResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiBody({ type: CreateWebhookDto })
  public async create(
    @Body() dto: CreateWebhookDto,
  ): Promise<WebhookResponseDto> {
    return this.webhooksService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List registered webhook endpoints' })
  @ApiResponse({
    status: 200,
    description: 'Active webhooks',
    type: [WebhookResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  public async findAll(): Promise<WebhookResponseDto[]> {
    return this.webhooksService.findAll();
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a webhook subscription' })
  @ApiResponse({
    status: 200,
    description: 'Webhook updated successfully',
    type: WebhookResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  @ApiBody({ type: UpdateWebhookDto })
  public async update(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ): Promise<WebhookResponseDto> {
    return this.webhooksService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a webhook subscription' })
  @ApiResponse({
    status: 200,
    description: 'Webhook deactivated successfully',
  })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  public async remove(@Param('id') id: string): Promise<void> {
    await this.webhooksService.remove(id);
  }
}
