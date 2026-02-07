import { describe, expect, it } from "vitest";
import {
  type EndpointCircuitState,
  getEndpointStatusModel,
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
