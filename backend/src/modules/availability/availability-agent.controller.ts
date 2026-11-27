import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { AgentRateLimiter } from './agent-rate-limiter';
import { AgentRequest, AgentTokenGuard } from './agent-token.guard';
import { AvailabilityAgentService } from './availability-agent.service';
import { AgentSampleDto, AgentSampleResponse } from './dto/agent.dto';

/**
 * El contrato del agente dice `400 BAD_INPUT` (el resto del proyecto usa
 * `VALIDATION_ERROR`): mismo cuerpo que `HttpExceptionFilter`, solo cambia el código.
 */
@Catch(BadRequestException)
export class AgentBadInputFilter extends HttpExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const r = exception.getResponse();
    const body =
      typeof r === 'object' && r !== null
        ? { ...(r as Record<string, unknown>), code: 'BAD_INPUT' }
        : { code: 'BAD_INPUT', message: r };
    super.catch(new BadRequestException(body), host);
  }
}

/**
 * Lo que llama el agente de servidor (Task 10). Solo `AgentTokenGuard`: NO
 * lleva `JwtAuthGuard` (llama una máquina). El tope de 64 KB del cuerpo lo pone
 * `registerProbeIngestJsonLimit`; los de cada lista, el DTO.
 */
@Controller('ingest/probe/agent')
@UseGuards(AgentTokenGuard)
@UseFilters(AgentBadInputFilter)
export class AvailabilityAgentController {
  constructor(
    private readonly agent: AvailabilityAgentService,
    private readonly limiter: AgentRateLimiter,
  ) {}

  @Post('samples')
  @HttpCode(200)
  async samples(
    @Req() req: AgentRequest,
    @Body() dto: AgentSampleDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgentSampleResponse> {
    const server = req.server!;
    const taken = this.limiter.take(Number(server.id), Date.now());
    if (!taken.ok) {
      res.setHeader('Retry-After', String(taken.retryAfterSec));
      throw new HttpException(
        { code: 'TOO_MANY_REQUESTS', message: 'El agente envió otra muestra antes de 20 segundos.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.agent.acceptSample(server, dto, new Date());
  }
}
