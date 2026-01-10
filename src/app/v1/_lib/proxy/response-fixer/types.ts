export type FixResult<T> = {
  data: T;
  applied: boolean;
  details?: string;
};
