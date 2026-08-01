/** OpenAPI 3 minimal — API publique partenaire + auth sandbox. */

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "AOTC Sandbox API",
    version: "0.2.0",
    description:
      "API sandbox Lot 2 — paiements, marché et ordres simulés. Authentification partenaire via Bearer aotc_sk_...",
  },
  servers: [{ url: "/", description: "local" }],
  paths: {
    "/api/v1/market": {
      get: {
        summary: "Liste des instruments",
        security: [{ PartnerApiKey: [] }],
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/v1/orders": {
      get: {
        summary: "Ordres de la session",
        security: [{ PartnerApiKey: [] }],
        responses: { "200": { description: "OK" } },
      },
      post: {
        summary: "Placer un ordre",
        security: [{ PartnerApiKey: [] }],
        responses: {
          "200": { description: "Exécuté" },
          "422": { description: "Rejeté" },
        },
      },
    },
    "/api/auth/otp/request": {
      post: {
        summary: "Demander un OTP sandbox",
        responses: { "200": { description: "dev_code retourné" } },
      },
    },
    "/api/payments/intent": {
      post: {
        summary: "Créer un intent de paiement simulé",
        responses: { "200": { description: "Intent pending" } },
      },
    },
    "/api/payments/webhook": {
      post: {
        summary: "Confirmer un paiement (signature sandbox|hmac)",
        responses: { "200": { description: "Intent succeeded" } },
      },
    },
  },
  components: {
    securitySchemes: {
      PartnerApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "aotc_sk_",
      },
    },
  },
} as const;
