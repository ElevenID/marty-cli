/* @ts-self-types="./marty_api_client.d.ts" */
import * as wasm from "./marty_api_client_bg.wasm";
import { __wbg_set_wasm } from "./marty_api_client_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    MartyApiClient, getErrorCode, getErrorMessage, handleApiError, isAuthError, isRetryableError, mipVersion
} from "./marty_api_client_bg.js";
