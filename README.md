# Authentication & Authorization in Microservices Architecture

A practical implementation example for authentication and authorization in microservices using Ory Hydra, Ory Kratos, Apache APISIX, and Go microservices.

📚 **For detailed explanation and theory, see [ARTICLE.md](doc/ARTICLE.md)**

## 🏗️ What This Demonstrates

Two approaches to microservices authorization:

1. **JWT-based approach** - Simple roles in JWT tokens
2. **Opaque tokens + introspection** - Flexible permissions with real-time validation

**Tech Stack:** Ory Kratos + Hydra, Apache APISIX, Go microservices, PostgreSQL

## 🚀 Quick Start

```bash
# 1. Start all services
docker-compose up -d

# 2. Add to /etc/hosts (required for demo)
echo "127.0.0.1	hydra" >> /etc/hosts

# 3. Register OAuth2 client
curl -X POST http://localhost:4445/admin/clients \
  -H 'Content-Type: application/json' \
  -d '{
      "client_id": "web",
      "client_secret": "web-secret",
      "grant_types": ["authorization_code", "refresh_token"],
      "response_types": ["code", "id_token"],
      "scope": "openid offline users:read products:read orders:read",
      "redirect_uris": ["http://hydra:4444/callback"]
  }'

# 4. Create user at http://127.0.0.1:4455
# 5. Get access token at http://127.0.0.1:3001
# 6. Test protected endpoint:
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:9080/users/123
```

## 🛠️ Services

| Service | Port | Description |
|---------|------|-------------|
| Kratos (Public) | 4433 | Identity management API |
| Kratos (Admin) | 4434 | Admin API for identity management |
| Kratos UI | 4455 | Self-service UI for registration/login |
| Hydra (Public) | 4444 | OAuth2/OIDC endpoints |
| Hydra (Admin) | 4445 | Admin API for client management |
| Token Demo App | 3001 | OAuth2 flow demonstration |
| APISIX Gateway | 9080 | API Gateway (protected endpoints) |
| APISIX Admin | 9180 | Gateway administration |
| APISIX Dashboard | 9000 | Web UI for APISIX (admin/admin) |
| Users Service | 8081 | Direct access (bypass gateway) |
| Products Service | 8082 | Direct access (bypass gateway) |
| Orders Service | 8083 | Direct access (bypass gateway) |
| MailSlurper | 4436 | Email testing interface |

## 📋 Key Features

- **Dual authorization approaches** (JWT vs Opaque tokens)
- **OAuth2/OIDC flows** with Ory Hydra
- **API Gateway integration** with Apache APISIX
- **Fine-grained permissions** in Go microservices
- **Complete Docker setup** for easy testing

## 🔍 Testing Examples

```bash
# Check if services are ready
curl http://127.0.0.1:4444/health/ready

# Validate token
curl -X POST http://localhost:4445/oauth2/introspect \
     --user "web:web-secret" \
     --data-urlencode "token=YOUR_TOKEN"

# Test different permissions
curl -H "Authorization: Bearer TOKEN" http://localhost:9080/users/    # needs users:read
curl -H "Authorization: Bearer TOKEN" http://localhost:9080/products/ # needs products:read
```

## ⚠️ Production Notes

This is a **development setup**. For production:
- Use HTTPS everywhere
- Configure proper secrets
- Implement token caching
- Use internal DNS (not `/etc/hosts`)
- Add monitoring and logging

## 📚 Learn More

- [Detailed Article](doc/ARTICLE.md) - Complete explanation (Russian)
- [Ory Documentation](https://www.ory.sh/docs)
- [Apache APISIX Documentation](https://apisix.apache.org/docs)