import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "glorious-youthfulness";
export default defineRailway(() => {
  const gloriousYouthfulness = service("glorious-youthfulness", {
    source: github("Huno705/xe_may_BE", { branch: "main", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "NIXPACKS" },
    start: "npm start",
    healthcheck: "/api/ready",
    healthcheckTimeout: 60,
    deploy: { sleepApplication: false, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    replicas: { "sfo": 1 },
  });

  return project("radiant-optimism", {
    variables: { managed: false },
    resources: [gloriousYouthfulness],
  });
});
