/**
 * ============================================================================
 * E-Verify Platform - Employer Controller
 * ============================================================================
 * Clean architecture REST controller handling employer search requests.
 * Compatible with NestJS routing and standard Express HTTP middleware.
 * ============================================================================
 */

import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { EmployerService } from '../services/employer.service';
import { SearchEmployerDto } from '../dtos/search-employer.dto';
import { SearchEmployersResult } from '../../common/types';

@Controller('api/employers')
export class EmployerController {
  constructor(private readonly employerService: EmployerService) {}

  /**
   * Search E-Verify participating employers with pg_trgm fuzzy matching.
   * Endpoint: GET /api/employers/search?q=google&state=CA&limit=20&page=1
   */
  @Get('search')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async search(@Query() queryDto: SearchEmployerDto): Promise<SearchEmployersResult> {
    try {
      return await this.employerService.search({
        q: queryDto.q,
        state: queryDto.state,
        limit: queryDto.limit,
        page: queryDto.page,
      });
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: (error as Error).message || 'Failed to execute employer search query',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}

/**
 * Express-compatible route handler for zero-dependency standalone execution.
 */
export function createExpressSearchHandler(employerService: EmployerService) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q || q.length < 2) {
      res.status(400).json({
        success: false,
        error: 'Query parameter "q" must be at least 2 characters long.',
      });
      return;
    }

    const state = typeof req.query.state === 'string' ? req.query.state.trim().toUpperCase() : undefined;
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string, 10) || 20), 100);
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);

    try {
      const result = await employerService.search({ q, state, limit, page });
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.json(result);
    } catch (error) {
      console.error('[API ERROR] Failed to process search request:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error processing employer search query.',
      });
    }
  };
}
