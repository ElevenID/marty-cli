/* tslint:disable */
/* eslint-disable */

export class MartyApiClient {
    free(): void;
    [Symbol.dispose](): void;
    apiRequest(endpoint: string, options: any): Promise<any>;
    delete(endpoint: string, options: any): Promise<any>;
    fetchWithRetry(url: string, options: any, retry_config: any): Promise<Response>;
    get(endpoint: string, options: any): Promise<any>;
    constructor(base_url: string, request_options?: Function | null);
    patch(endpoint: string, data: any, options: any): Promise<any>;
    post(endpoint: string, data: any, options: any): Promise<any>;
    put(endpoint: string, data: any, options: any): Promise<any>;
    reportClientError(report: any): Promise<any>;
}

export function getErrorCode(error: any): string | undefined;

export function getErrorMessage(error: any): string;

export function handleApiError(error: any): any;

export function isAuthError(error: any): boolean;

export function isRetryableError(error: any): boolean;

export function mipVersion(): string;
