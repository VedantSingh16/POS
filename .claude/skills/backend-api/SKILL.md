# Backend API

Keep controllers thin and services responsible for business rules. Every authenticated query must derive organisation identity from the session, validate store scope server-side, use typed request contracts, and return stable HTTP error codes. Add an endpoint test for each security-sensitive rule.
