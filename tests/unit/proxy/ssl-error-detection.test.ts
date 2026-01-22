/**
 * SSL Certificate Error Detection Tests
 *
 * TDD: Tests written first, implementation follows
 */
import { describe, expect, it } from "vitest";
import { isSSLCertificateError } from "@/app/v1/_lib/proxy/errors";

describe("isSSLCertificateError", () => {
  describe("should detect SSL certificate errors", () => {
    it("should detect certificate hostname mismatch", () => {
      const error = new Error("Hostname/IP does not match certificate's altnames");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect ERR_TLS_CERT_ALTNAME_INVALID", () => {
      const error = new Error("ERR_TLS_CERT_ALTNAME_INVALID");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect self-signed certificate error", () => {
      const error = new Error("self signed certificate");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect depth_zero_self_signed_cert", () => {
      const error = new Error("depth_zero_self_signed_cert");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect expired certificate error", () => {
      const error = new Error("certificate has expired");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect cert_has_expired", () => {
      const error = new Error("cert_has_expired");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect unable to verify certificate", () => {
      const error = new Error("unable to verify the first certificate");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect unable_to_verify_leaf_signature", () => {
      const error = new Error("unable_to_verify_leaf_signature");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect unable_to_get_issuer_cert", () => {
      const error = new Error("unable_to_get_issuer_cert");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect SSL handshake error", () => {
      const error = new Error("SSL handshake failed");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect TLS error", () => {
      const error = new Error("TLS connection failed");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect certificate chain error", () => {
      const error = new Error("certificate chain is invalid");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect CERT_UNTRUSTED", () => {
      const error = new Error("CERT_UNTRUSTED");
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect error with code property", () => {
      const error = new Error("Connection failed") as NodeJS.ErrnoException;
      error.code = "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
      expect(isSSLCertificateError(error)).toBe(true);
    });

    it("should detect error with name containing SSL", () => {
      const error = new Error("Connection failed");
      error.name = "SSLError";
      expect(isSSLCertificateError(error)).toBe(true);
    });
  });

  describe("should not match non-SSL errors", () => {
    it("should not match connection refused error", () => {
      const error = new Error("Connection refused");
      expect(isSSLCertificateError(error)).toBe(false);
    });

    it("should not match timeout error", () => {
      const error = new Error("Request timeout");
      expect(isSSLCertificateError(error)).toBe(false);
    });

    it("should not match DNS error", () => {
      const error = new Error("getaddrinfo ENOTFOUND api.example.com");
      expect(isSSLCertificateError(error)).toBe(false);
    });

    it("should not match network unreachable error", () => {
      const error = new Error("Network is unreachable");
      expect(isSSLCertificateError(error)).toBe(false);
    });

    it("should not match HTTP error", () => {
      const error = new Error("HTTP 500 Internal Server Error");
      expect(isSSLCertificateError(error)).toBe(false);
    });

    it("should not match abort error", () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      expect(isSSLCertificateError(error)).toBe(false);
    });

    it("should not match ECONNRESET", () => {
      const error = new Error("Connection reset by peer") as NodeJS.ErrnoException;
      error.code = "ECONNRESET";
      expect(isSSLCertificateError(error)).toBe(false);
    });

    it("should not match ETIMEDOUT", () => {
      const error = new Error("Connection timed out") as NodeJS.ErrnoException;
      error.code = "ETIMEDOUT";
      expect(isSSLCertificateError(error)).toBe(false);
    });

    it("should not match generic error", () => {
      const error = new Error("Something went wrong");
      expect(isSSLCertificateError(error)).toBe(false);
    });

    it("should not match empty error message", () => {
      const error = new Error("");
      expect(isSSLCertificateError(error)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle non-Error objects", () => {
      expect(isSSLCertificateError("certificate error")).toBe(false);
      expect(isSSLCertificateError(null)).toBe(false);
      expect(isSSLCertificateError(undefined)).toBe(false);
      expect(isSSLCertificateError(123)).toBe(false);
      expect(isSSLCertificateError({})).toBe(false);
    });

    it("should handle Error with undefined message", () => {
      const error = new Error();
      expect(isSSLCertificateError(error)).toBe(false);
    });

    it("should be case insensitive", () => {
      expect(isSSLCertificateError(new Error("CERTIFICATE ERROR"))).toBe(true);
      expect(isSSLCertificateError(new Error("Certificate Error"))).toBe(true);
      expect(isSSLCertificateError(new Error("SSL_ERROR"))).toBe(true);
      expect(isSSLCertificateError(new Error("Ssl_Error"))).toBe(true);
    });

    it("should detect SSL error in nested cause", () => {
      const cause = new Error("self signed certificate");
      const error = new Error("Request failed", { cause });
      // Note: This test documents expected behavior - implementation may need to check cause
      expect(isSSLCertificateError(error)).toBe(true);
    });
  });
});
