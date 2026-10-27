/**
 * ============================================================================
 * E-Verify Platform - Search Employers Query DTO
 * ============================================================================
 * Request parameter validation and transformation using class-validator
 * and class-transformer.
 * ============================================================================
 */

import { IsInt, IsNotEmpty, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class SearchEmployerDto {
  /**
   * Search query keyword. Minimum 2 characters required for meaningful trigram analysis.
   */
  @IsNotEmpty({ message: 'Search query parameter "q" is required.' })
  @IsString({ message: 'Search query "q" must be a string.' })
  @Length(2, 100, { message: 'Search query "q" must be between 2 and 100 characters.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q!: string;

  /**
   * Optional 2-letter uppercase US state code (e.g., "CA", "NY").
   */
  @IsOptional()
  @IsString({ message: 'State filter must be a string.' })
  @Length(2, 2, { message: 'State code must be exactly 2 letters (e.g. CA, NY).' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : undefined))
  state?: string;

  /**
   * Number of results to return per page. Defaults to 20, max 100.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit must be an integer.' })
  @Min(1, { message: 'Limit must be at least 1.' })
  @Max(100, { message: 'Limit cannot exceed 100 records per page.' })
  limit: number = 20;

  /**
   * Page number (1-based). Defaults to 1.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be an integer.' })
  @Min(1, { message: 'Page must be at least 1.' })
  page: number = 1;
}
