import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const request = ctx.getRequest();
    const url = httpAdapter.getRequestUrl(request);
    const method = httpAdapter.getRequestMethod(request);

    const errorMessage =
      exception instanceof Error ? exception.message : String(exception);
    const stackTrace = exception instanceof Error ? exception.stack : undefined;

    this.logger.error(
      `[${method}] ${url} - Status: ${httpStatus} - Error: ${errorMessage}`,
      stackTrace,
    );

    const responseBody = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: url,
      message: httpStatus === HttpStatus.INTERNAL_SERVER_ERROR 
        ? 'Internal server error' 
        : errorMessage,
    };

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }
}
