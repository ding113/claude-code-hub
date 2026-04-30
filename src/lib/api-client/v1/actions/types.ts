export type SuccessResult<T = undefined> = T extends undefined
  ? { ok: true; data?: undefined }
  : { ok: true; data: T };

export type ErrorResult = {
  ok: false;
  error: string;
  errorCode?: string;
  errorParams?: Record<string, string | number>;
};

export type ActionResult<T = undefined> = SuccessResult<T> | ErrorResult;
