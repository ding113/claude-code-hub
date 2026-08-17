export interface StreamGateResponsePolicy {
  allowTerminalOnlyCommit: boolean;
}

const responsePolicies = new WeakMap<Response, StreamGateResponsePolicy>();

export function setStreamGateResponsePolicy(
  response: Response,
  policy: StreamGateResponsePolicy
): void {
  responsePolicies.set(response, policy);
}

export function getStreamGateResponsePolicy(
  response: Response
): StreamGateResponsePolicy | undefined {
  return responsePolicies.get(response);
}

export function inheritStreamGateResponsePolicy(source: Response, target: Response): void {
  const policy = responsePolicies.get(source);
  if (policy) responsePolicies.set(target, policy);
}
