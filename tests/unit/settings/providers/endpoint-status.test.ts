import { describe, expect, it } from "vitest";
import {
  type EndpointCircuitState,
  getEndpointStatusModel,
  type IncidentSource,
  resolveEndpointDisplayStatus,
} from "@/app/[locale]/settings/providers/_components/endpoint-status";
import { AlertTriangle, Ban, CheckCircle2, HelpCircle, XCircle } from "lucide-react";

describe("getEndpointStatusModel", () => {
  const createEndpoint = (lastProbeOk: boolean | null) => ({ lastProbeOk });

  describe("Circuit Breaker Priority", () => {
    it("should return circuit-open status when circuit is open, regardless of probe", () => {
      const endpoint = createEndpoint(true); // Probe is OK
      const result = getEndpointStatusModel(endpoint, "open");

      expect(result).toEqual({
        status: "circuit-open",
        labelKey: "settings.providers.endpointStatus.circuitOpen",
        severity: "error",
        icon: Ban,
        color: "text-rose-500",
        bgColor: "bg-rose-500/10",
        borderColor: "border-rose-500/30",
      });
    });

    it("should return circuit-half-open status when circuit is half-open", () => {
      const endpoint = createEndpoint(false); // Probe is bad
      const result = getEndpointStatusModel(endpoint, "half-open");

      expect(result).toEqual({
        status: "circuit-half-open",
        labelKey: "settings.providers.endpointStatus.circuitHalfOpen",
        severity: "warning",
        icon: AlertTriangle,
        color: "text-amber-500",
        bgColor: "bg-amber-500/10",
        borderColor: "border-amber-500/30",
      });
    });
  });

  describe("Probe Status Fallback (Circuit Closed or Missing)", () => {
    it.each([
      { circuit: "closed" as EndpointCircuitState },
      { circuit: null },
      { circuit: undefined },
    ])("should return healthy when probe is ok and circuit is $circuit", ({ circuit }) => {
      const endpoint = createEndpoint(true);
      const result = getEndpointStatusModel(endpoint, circuit);

      expect(result).toEqual({
        status: "healthy",
        labelKey: "settings.providers.endpointStatus.healthy",
        severity: "success",
        icon: CheckCircle2,
        color: "text-emerald-500",
        bgColor: "bg-emerald-500/10",
        borderColor: "border-emerald-500/30",
      });
    });

    it.each([
      { circuit: "closed" as EndpointCircuitState },
      { circuit: null },
      { circuit: undefined },
    ])("should return unhealthy when probe is failed and circuit is $circuit", ({ circuit }) => {
      const endpoint = createEndpoint(false);
      const result = getEndpointStatusModel(endpoint, circuit);

      expect(result).toEqual({
        status: "unhealthy",
        labelKey: "settings.providers.endpointStatus.unhealthy",
        severity: "error",
        icon: XCircle,
        color: "text-rose-500",
        bgColor: "bg-rose-500/10",
        borderColor: "border-rose-500/30",
      });
    });

    it.each([
      { circuit: "closed" as EndpointCircuitState },
      { circuit: null },
      { circuit: undefined },
    ])("should return unknown when probe is null and circuit is $circuit", ({ circuit }) => {
      const endpoint = createEndpoint(null);
      const result = getEndpointStatusModel(endpoint, circuit);

      expect(result).toEqual({
        status: "unknown",
        labelKey: "settings.providers.endpointStatus.unknown",
        severity: "neutral",
        icon: HelpCircle,
        color: "text-slate-400",
        bgColor: "bg-slate-400/10",
        borderColor: "border-slate-400/30",
      });
    });
  });
});

describe("IncidentSource", () => {
  it("should have correct type values", () => {
    const source: IncidentSource = "provider";
    expect(source).toBe("provider");

    const endpointSource: IncidentSource = "endpoint";
    expect(endpointSource).toBe("endpoint");
  });
});

describe("resolveEndpointDisplayStatus", () => {
  const createEndpoint = (lastProbeOk: boolean | null, isEnabled?: boolean) =>
    ({ lastProbeOk, isEnabled }) as { lastProbeOk: boolean | null; isEnabled?: boolean };

  describe("Priority: circuit-open", () => {
    it("should return circuit-open with endpoint source when circuit is open", () => {
      const endpoint = createEndpoint(true);
      const result = resolveEndpointDisplayStatus(endpoint, "open");

      expect(result).toEqual({
        status: "circuit-open",
        source: "endpoint",
        priority: 0,
      });
    });

    it("should return circuit-open even when probe is failed", () => {
      const endpoint = createEndpoint(false);
      const result = resolveEndpointDisplayStatus(endpoint, "open");

      expect(result).toEqual({
        status: "circuit-open",
        source: "endpoint",
        priority: 0,
      });
    });
  });

  describe("Priority: circuit-half-open", () => {
    it("should return circuit-half-open with endpoint source when circuit is half-open", () => {
      const endpoint = createEndpoint(false);
      const result = resolveEndpointDisplayStatus(endpoint, "half-open");

      expect(result).toEqual({
        status: "circuit-half-open",
        source: "endpoint",
        priority: 1,
      });
    });

    it("should return circuit-half-open even when probe is ok", () => {
      const endpoint = createEndpoint(true);
      const result = resolveEndpointDisplayStatus(endpoint, "half-open");

      expect(result).toEqual({
        status: "circuit-half-open",
        source: "endpoint",
        priority: 1,
      });
    });
  });

  describe("Priority: enabled/disabled (circuit-closed)", () => {
    it("should return enabled when circuit is closed and endpoint is enabled", () => {
      const endpoint = createEndpoint(true, true);
      const result = resolveEndpointDisplayStatus(endpoint, "closed");

      expect(result).toEqual({
        status: "enabled",
        source: "provider",
        priority: 2,
      });
    });

    it("should return disabled when circuit is closed and endpoint is disabled", () => {
      const endpoint = createEndpoint(true, false);
      const result = resolveEndpointDisplayStatus(endpoint, "closed");

      expect(result).toEqual({
        status: "disabled",
        source: "provider",
        priority: 3,
      });
    });

    it("should return enabled when circuit is closed and isEnabled is undefined", () => {
      const endpoint = createEndpoint(true, undefined);
      const result = resolveEndpointDisplayStatus(endpoint, "closed");

      expect(result).toEqual({
        status: "enabled",
        source: "provider",
        priority: 2,
      });
    });

    it("should return enabled when circuit is closed and isEnabled is null", () => {
      const endpoint = createEndpoint(true, null as unknown as undefined);
      const result = resolveEndpointDisplayStatus(endpoint, "closed");

      expect(result).toEqual({
        status: "enabled",
        source: "provider",
        priority: 2,
      });
    });
  });

  describe("Priority ordering", () => {
    it("should have circuit-open (0) > circuit-half-open (1) > enabled (2) > disabled (3)", () => {
      const endpoint = createEndpoint(true, true);

      const openResult = resolveEndpointDisplayStatus(endpoint, "open");
      const halfOpenResult = resolveEndpointDisplayStatus(endpoint, "half-open");
      const enabledResult = resolveEndpointDisplayStatus(endpoint, "closed");

      const disabledEndpoint = createEndpoint(true, false);
      const disabledResult = resolveEndpointDisplayStatus(disabledEndpoint, "closed");

      expect(openResult.priority).toBe(0);
      expect(halfOpenResult.priority).toBe(1);
      expect(enabledResult.priority).toBe(2);
      expect(disabledResult.priority).toBe(3);
    });
  });

  describe("Null/undefined circuit state", () => {
    it("should return enabled when circuit is null and endpoint is enabled", () => {
      const endpoint = createEndpoint(true, true);
      const result = resolveEndpointDisplayStatus(endpoint, null);

      expect(result).toEqual({
        status: "enabled",
        source: "provider",
        priority: 2,
      });
    });

    it("should return enabled when circuit is undefined", () => {
      const endpoint = createEndpoint(true, true);
      const result = resolveEndpointDisplayStatus(endpoint, undefined);

      expect(result).toEqual({
        status: "enabled",
        source: "provider",
        priority: 2,
      });
    });
  });

  describe("Edge cases", () => {
    it("should handle endpoint without isEnabled property", () => {
      const endpoint = { lastProbeOk: true } as { lastProbeOk: boolean | null };
      const result = resolveEndpointDisplayStatus(endpoint, "closed");

      expect(result).toEqual({
        status: "enabled",
        source: "provider",
        priority: 2,
      });
    });

    it("should return circuit-open when probe is null and circuit is open", () => {
      const endpoint = createEndpoint(null);
      const result = resolveEndpointDisplayStatus(endpoint, "open");

      expect(result).toEqual({
        status: "circuit-open",
        source: "endpoint",
        priority: 0,
      });
    });
  });
});
