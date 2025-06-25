# Гайд по реализации авторизация и аутентификация в микросервисной архитектуре

Мне кажется что уже есть сотня разных статей на эту тему, но каждый раз мне чего-то не хватало. Поэтому я решил
написать свою статью, в которой покажу как я реализую авторизацию и аутентификацию в своих проектах. Это именно гайд, вы
можете взять готовый код и адаптировать его под свои нужды. В рамках статьи будет использовать Ory Hydra и Ory Kratos,
Apache APISIX в качестве API Gateway и несколько микросервисов на Golang. Все это будет работать в Docker, что бы вы
могли легко запустить и поиграться.

На теорию много времени тратить не буду, можете посмотреть несколько статьей по ссылкам ниже:

- [Авторизация и аутентификация в микросервисной архитектуре](https://habr.com/ru/companies/spectr/articles/715290/)
- [Микросервисная авторизация для чайников для чайников](https://habr.com/ru/articles/528214/)

В начале я хотел показать все в рамках Kubernetes, но потом решил, что это будет излишне сложно в рамках статьи, поэтому
покажу в рамках простого docker-compose, что бы каждый мог легко запустить.

> В рамках статьи, я иду на определенные упрощения, например используют стандартные пароли, не использую https и т.д.
> Это сделано для того, что бы вы могли легко запустить и протестировать систему. В реальных проектах, конечно же,
> не нужно так делать.

## Архитектура

Если с аутентификацией все более-менее понятно, то с авторизацией все сложнее. Можно выделить несколько основных
сценариев работы:

1. Используем простые, статичные роли, которые редко меняются. Например, `admin`, `user`, `guest` и т.д.
2. Нужен больший контроль и динамическое управление доступом, например, разрешения на определенные действия для
   разных ролей. И делать все атомарно. Тогда у нас появляется дополнительный уровень - разрешения/права, которые
   назначаются в рамках микросервиса, а потом назначаются на конкретные роли. Здесь уже явно нужен отдельный сервис, как
   минимум для централизованого управления, но все еще не требуется специализированная система.
3. Нужна сложная система управления доступом, которая может включать в себя RBAC (Role-Based Access Control) или
   ABAC (Attribute-Based Access Control). Это уже сложные системы, которые требуют отдельного сервиса для управления
   доступом и могут быть избыточными для большинства проектов.

С третьим все сложно, но есть готовые решения (например, Casbin, Ory Keto и т.д.), которые можно использовать. Правда
это не гарантия того что установите и поедете. Мы в свое время испугались использовать casbin и правильно сделали. Все
решилось сильно проще.

А вот первое и второе мы разберем в рамках этой статьи. Для реализации первых двух вариантов, кажется что проще
всего использовать JWT (JSON Web Token). Но это не совсем так. JWT имеет ограничение, точнее не сколько он,
сколько информация передаваемая в заголовке. Если правильно помню - NGINX/Apache имеет лимит
в 8кб на заголовок, а это значит что мы не можем хранить слишком много информации в JWT. То есть если для первого
варианта однозначно подойдет, то для второго варианта, уже будет зависеть от того на сколько атомарно мы делим и сколько
у нас микросервисов. Потому что если у нас 100 микросервисов, в каждом из которых будет свой scope на каждую CRUD
ручку (news:read, order:create и т.д.), то выйдет примерно 4.88 килобайт что уже близко к лимиту, а у нас в заголовках
не только JWT.

Поэтому для первого варианта, мы будем использовать JWT, а для второго варианта - будем использовать opaque токены и
ходить в сервис для получения информации о пользователе и его разрешениях. Это позволит нам избежать проблем с размером
заголовка и упростит управление доступом. Но как можно понять, это добавит один накладные расходы, но мы их сгладим за
счет кэширования на время жизни токена на стороне API Gateway. Он будет отвечать за проверку токена и ролей.

В первом случае, у нас будет следующий путь:

1. Пользователь проходит аутентификацию через отдельный сервис.
2. Сервис аутентификации выдает JWT токен, который содержит информацию о пользователе и его ролях.
3. Пользователь отправляет запросы к микросервисам, передавая JWT токен в заголовке Authorization.
4. Запрос проходит через API Gateway, который проверяет JWT токен и извлекает информацию о пользователе.
5. API Gateway проверяет, есть ли у пользователя нужная роль с которой можно в микросервис, и перенаправляет запрос к
   нужному микросервису.
6. Микросервис выполняет действие и возвращает ответ. В рамках самого микросервиса проверки уже не делаем.

Во втором случае, у нас будет похожий путь, но вместо JWT мы выдаем opaque токен, в API Gateway так же проверяем роли
после
запроса к сервису аутентификации, а на микросервисах добавляем middleware, который будет проверять разрешения на ручках.

Давайте выберем и поднимем всю необходимую инфраструктуру, что бы у нас была возможность протестировать оба варианта.

## Система авторизации/аутентификации

В качестве системы, мы можем написать свой сервис, но с учетом огромного количества готовых решений, я думаю, что
лучше использовать готовое решение, которое можно легко интегрировать в нашу архитектуру.

Я думаю что многие хоть раз слышали о [Keycloak](https://www.keycloak.org/). Он надежный, стабильный и имеет много
возможностей, но у него есть пару недостатков:

1. Это довольно большой комбайн, который может быть избыточным.
2. У него монолитная архитектура, что может усложнить масштабирование и поддержку. Но самое главное в этом - если вы не
   знаете Java, то вам будет сложно его настраивать и поддерживать. Даже банально сделать свою страницу входа - уже не
   просто.

Ок, мы понимаем что нам нужно что-то простое и гибкое. В идеале, что-то что можно легко развернуть и настроить,
API-first. Стек должен быть доступным, что бы иметь возможность например написать своего провайдера. Так же одним из
требований - развертывание в нашей инфраструктуре, а не в облаке. И тут остается много вариантов, но я в начале
остановился на нескольких:

1. Ory Hydra / Ory Kratos - имеет микросервисную архитектуру и хорошо документирован. Написан на Go. Достаточно
   популярный, сейчас планируется всего по паре релизов в год. Его использует OpenAPI, что дает надежду на стабильность.
   12к звезд на GitHub. Kratos отвечает за аутентификацию, а Hydra - за авторизацию.
2. Casdoor - очень легкий для старта, есть готовые интерфейсы на React которые можно переделать под себя, использовал в
   проде. Поддерживает все самые популярные способы аутентификации, есть авторизация. Написан на Go, провайдеров писать
   очень просто. 11к звезд на GitHub. Из минусов - очень частые релизы, не быстро исправляют уязвимости. Сложный
   интерфейс для управления ролями, проще самому написать (API First подход присутствует) Сейчас очень сосредоточены на
   развитии SAAS решения.
3. Authelia - очень интересное решение, есть сертификат OpenID. Звезд внушительно - 24к. Узнал о нем при подготовке
   статьи.

В рамках статьи я буду использовать Ory Hydra/Kratos, просто потому что хочу его пощупать. Для этого и нужны статьи:)
Для продакшена каждый выбирает инструмент под свои задачи и свой стек. А это статья поможет вам поэкспериментировать,
прежде чем выбрать инструмент для своей системы.

Давайте поднимем Ory Kratos в docker-compose. Для этого создадим файл `docker-compose.yml`:

```yaml
services:
  # Migration service for Kratos
  kratos-migrate:
    image: oryd/kratos:v1.3.1
    environment:
      - DSN=postgres://kratos:secret@kratos-pg:5432/kratos?sslmode=disable&max_conns=20&max_idle_conns=4
    volumes:
      - type: bind
        source: ./docker/kratos/configs
        target: /etc/config/kratos
    depends_on:
      - kratos-pg
    command: -c /etc/config/kratos/kratos.yml migrate sql -e --yes
    restart: on-failure
    networks:
      - intranet

  # Postgres database for Kratos
  kratos-pg:
    image: postgres:17
    environment:
      - POSTGRES_USER=kratos
      - POSTGRES_PASSWORD=secret
      - POSTGRES_DB=kratos
    healthcheck:
      test: [ "CMD-SHELL", "pg_isready -U kratos" ]
    networks:
      - intranet

  # Example selfservice UI for Kratos. Just a simple Node.js app that uses Kratos for authentication.
  kratos-selfservice-ui-node:
    image: oryd/kratos-selfservice-ui-node:v1.3.1
    ports:
      - "4455:3000"
    environment:
      - KRATOS_PUBLIC_URL=http://kratos:4433/
      - KRATOS_BROWSER_URL=http://127.0.0.1:4433/
      - COOKIE_SECRET=changeme
      - CSRF_COOKIE_NAME=ory_csrf_ui
      - CSRF_COOKIE_SECRET=changeme
    networks:
      - intranet
    restart: on-failure

  # Ory Kratos service
  kratos:
    depends_on:
      - kratos-migrate
    image: oryd/kratos:v1.3.1
    ports:
      - '4433:4433' # public
      - '4434:4434' # admin
    restart: unless-stopped
    environment:
      - DSN=postgres://kratos:secret@kratos-pg:5432/kratos?sslmode=disable&max_conns=20&max_idle_conns=4
      - LOG_LEVEL=trace
    command: serve -c /etc/config/kratos/kratos.yml --dev --watch-courier
    volumes:
      - type: bind
        source: ./docker/kratos/configs
        target: /etc/config/kratos
    networks:
      - intranet

  # Mail service for testing email flows
  mailslurper:
    image: oryd/mailslurper:latest-smtps
    ports:
      - '4436:4436' # Email UI
    networks:
      - intranet
networks:
  intranet:
```

После чего можем зайти в веб-интерфейс по адресу `http://127.0.0.1:4455` и зарегистрировать нового пользователя.
Тут важно использовать именно `127.0.0.1`, а не `localhost`. После того как зайдете под новым пользователям, можете
увидеть информацию о пользователе, попробовать поменять и подключить 2FA.

![Kratos Selfservice UI](./img/1_UI_Kratos.png)

Первый шаг сделан, теперь у нас есть сервис аутентификации, но для реализации авторизации нужен Oauth. Давайте добавим
сервис в нашу систему. Для этого мы будем использовать Ory Hydra, который будет работать с Ory Kratos для
аутентификации пользователей. Ory Hydra будет выступать в роли OAuth2 провайдера, который будет выдавать токены доступа.
Это позволит нам централизованно управлять доступом к ресурсам и сервисам в нашей микросервисной архитектуре.

Добавим Ory Hydra в наш `docker-compose.yml`:

```yaml
  # Ory Hydra migration service
  hydra-migrate:
    image: oryd/hydra:v2.3.0
    depends_on:
      - hydra-pg
    environment:
      - DSN=postgres://hydra:secret@hydra-pg:5432/hydra?sslmode=disable
    command: migrate -c /etc/config/hydra/hydra.yml sql up -e --yes
    volumes:
      - type: bind
        source: ./docker/hydra/config
        target: /etc/config/hydra
    networks:
      - intranet
    restart: on-failure

  # Ory Hydra Postgres database
  hydra-pg:
    image: postgres:17
    environment:
      - POSTGRES_USER=hydra
      - POSTGRES_PASSWORD=secret
      - POSTGRES_DB=hydra
    healthcheck:
      test: [ "CMD-SHELL", "pg_isready -U hydra" ]
    networks:
      - intranet

  # Ory Hydra service
  hydra:
    image: oryd/hydra:v2.3.0
    depends_on:
      - hydra-migrate
    ports:
      - "4444:4444" # Public
      - "4445:4445" # Admin
    environment:
      - DSN=postgres://hydra:secret@hydra-pg:5432/hydra?sslmode=disable
    volumes:
      - type: bind
        source: ./docker/hydra/config
        target: /etc/config/hydra
    command: serve -c /etc/config/hydra/hydra.yml all --dev
    networks:
      - intranet
    restart: unless-stopped
```

Теперь Ory Hydra запущен и готов к работе. Можем лего проверить если перейдем по адресу
`http://127.0.0.1:4444/health/ready`.

Ory из коробки поддерживает экспорт метрик в Prometheus и трейсы в Jaeger, поэтому вы можете легко интегрировать их.
Если не знакомы, можете почитать цикл моих статей и воспользоваться готовым репозиторием - вам будет достаточно
добавить конфигурацию для новых сервисов и все будет работать. В рамках этой статьи сюда углубляться не буду.

[Как я создавал Observability для своих pet-проектов. Часть 1](https://habr.com/ru/articles/885224/)

## Микросервисы

Теперь давайте создадим несколько микросервисов на Golang, в
рамках которых будем проверять разрешения на определенные действия. Пока сделаем простые CRUD сервисы, которые будут
отдавать
нам определенное сообщение и все. Логику будем делать позже, только в рамках проверки разрешений.

У нас будут следующие условные микросервисы:

- `users` - сервис для работы с пользователями.
- `products` - сервис для работы с продуктами.
- `orders` - сервис для работы с заказами.

Все сервисы будут в папке `cmd`, всю нашу "логику" будем писать в рамках одного main.go файла, что бы не усложнять.
main.go будет выглядеть следующим образом для каждого из сервисов:

```go
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gorilla/mux"
)

func main() {
	r := mux.NewRouter()
	service := os.Getenv("SERVICE_NAME")

	r.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "Hello from %s service!", service)
	}).Methods("GET")

	r.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "Create in %s service!", service)
	}).Methods("POST")

	r.HandleFunc("/{id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		fmt.Fprintf(w, "Read %s with id %s!", service, vars["id"])
	}).Methods("GET")

	r.HandleFunc("/{id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		fmt.Fprintf(w, "Update %s with id %s!", service, vars["id"])
	}).Methods("PUT")

	r.HandleFunc("/{id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		fmt.Fprintf(w, "Delete %s with id %s!", service, vars["id"])
	}).Methods("DELETE")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting %s service on port %s", service, port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
```

Теперь давайте создадим простой `Dockerfile` для каждого из сервисов, что бы мы могли их собрать и запустить в Docker:

```dockerfile
FROM golang:1.24-alpine AS builder
WORKDIR /build
COPY ./go.mod ./go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o products cmd/products/main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates && \
    addgroup -S appgroup && adduser -S appuser -G appgroup \
COPY --from=builder /build/products /app/products
USER appuser
WORKDIR /app
EXPOSE 8080
ENTRYPOINT ["/app/products", "sync", "-d"]
```

И добавляем наши сервисы в `docker-compose.yml`:

```yaml
  users:
    build:
      context: .
      dockerfile: users.Dockerfile
    environment:
      - SERVICE_NAME=users
      - PORT=8080
    ports:
      - "8081:8080"
    networks:
      - intranet

  products:
    build:
      context: .
      dockerfile: products.Dockerfile
    environment:
      - SERVICE_NAME=products
      - PORT=8080
    ports:
      - "8082:8080"
    networks:
      - intranet

  orders:
    build:
      context: .
      dockerfile: orders.Dockerfile
    environment:
      - SERVICE_NAME=orders
      - PORT=8080
    ports:
      - "8083:8080"
    networks:
      - intranet
```

После чего запускаем и пробуем постучать на один из сервисов - `http://127.0.1:8081/`. Получаем ответ "Hello from users
service!". Теперь осталось настроить последний сервис - API Gateway, который будет интегрирован с Ory Hydra и Ory
Kratos.

## Настройка API Gateway

Теперь, когда у нас есть сервисы аутентификации и авторизации, давайте настроим API Gateway, который будет
интегрирован с Ory Hydra и Ory Kratos. В качестве API Gateway чаще всего используют [Kong](https://konghq.com/kong/), но
мне хочется попробывать что-то новое, поэтому я выбрал [Apache APISIX](https://apisix.apache.org).

Добавляем его в наш `docker-compose.yml`:

```yaml
  etcd:
    image: bitnami/etcd:3.5
    environment:
      - ALLOW_NONE_AUTHENTICATION=yes
      - ETCD_ADVERTISE_CLIENT_URLS=http://0.0.0.0:2379
    networks:
      - intranet

  apisix:
    image: apache/apisix
    depends_on:
      - etcd
    ports:
      - "9080:9080"    # HTTP endpoint
      - "9180:9180"    # Admin-API
    volumes:
      - ./docker/apisix/config.yaml:/usr/local/apisix/conf/config.yaml
    environment:
      - APISIX_ENABLE_ADMIN=true
      - APISIX_ADMIN_KEY=supersecret
      - APSIX_ETCD_HOST=http://etcd:2379
    networks:
      - intranet

  apisix-dashboard:
    image: apache/apisix-dashboard
    depends_on:
      - apisix
    ports:
      - "9000:9000"
    volumes:
      - ./docker/apisix_dashboard_conf/config.yaml:/usr/local/apisix-dashboard/conf/conf.yaml
    environment:
      - DEFAULT_APISIX_ADMIN_KEY=supersecret
      - APISIX_LISTEN_ADDRESS=http://apisix:9091
    networks:
      - intranet
```

Делаем два конфиг файла для APISIX и APISIX Dashboard, что бы настроить их под себя.

Создадим файл `docker/apisix/config.yaml`:

```yaml
apisix:
  enable_admin: true
  admin_key:
    - name: admin
      key: supersecret
  allow_admin:
    - 0.0.0.0/0

deployment:
  role: traditional
  admin:
    admin_listen:
      port: 9180
    allow_admin:
      - 0.0.0.0/0
  etcd:
    host:
      - "http://etcd:2379"
    prefix: "/apisix"
    timeout: 30
```

И файл `docker/apisix_dashboard_conf/config.yaml`:

```yaml
conf:
  listen:
    port: 9000
  etcd:
    endpoints:
      - etcd:2379

authentication:
  secert: secert
  expire_time: 3600
  users:
    - username: admin
      password: admin
```

Открываем веб-интерфейс APISIX Dashboard по адресу `http://127.0.0.1:9000`, вводим логин и пароль `admin`/`admin`.

![APISIX Dashboard](./img/2_UI_APISIX.png)

## Создаем страницу для получения токена

`kratos-selfservice-ui-node` - который мы подняли ранее, не умеет работать с Ory Hydra, он отвечает только за
аутентификацию и регистрацию пользователей. Поэтому нам нужно создать страницу, которая будет работать с Ory Hydra и
получать токен доступа. Для этого мы создадим простую страницу на Node.js, которая будет использовать Ory Hydra для
получения токена доступа. Эта страница будет использоваться для получения токена доступа и перенаправления пользователя
на страницу Kratos Selfservice UI для аутентификации. Создадим папку `docker/hydra` и файл `index.js` в ней:

```javascript
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const session = require('express-session');

const app = express();
const port = 3001;

// Settings - explicitly specify IPv4 addresses
const HYDRA_PUBLIC_URL = process.env.HYDRA_PUBLIC_URL || 'http://127.0.0.1:4444';  // For browser
const HYDRA_INTERNAL_URL = process.env.HYDRA_INTERNAL_URL || 'http://hydra:4444'; // For internal requests from container
const HYDRA_ADMIN_URL = process.env.HYDRA_ADMIN_URL || 'http://hydra:4445';      // IPv4 for admin API
const CLIENT_ID = process.env.CLIENT_ID || 'web';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'web-secret';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://127.0.0.1:3001/callback';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3001';

console.log('App settings:');
console.log('HYDRA_PUBLIC_URL:', HYDRA_PUBLIC_URL);
console.log('HYDRA_INTERNAL_URL:', HYDRA_INTERNAL_URL);
console.log('HYDRA_ADMIN_URL:', HYDRA_ADMIN_URL);
console.log('CLIENT_ID:', CLIENT_ID);
console.log('REDIRECT_URI:', REDIRECT_URI);
console.log('APP_URL:', APP_URL);

app.use(session({
    secret: 'your-session-secret',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000 // 1 hour
    }
}));

app.use(express.urlencoded({extended: true}));
app.use(express.json());

// Middleware for debugging cookies and sessions
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`, {
        sessionID: req.sessionID,
        cookies: req.headers.cookie,
        session: req.session
    });
    next();
});

// ============= OAuth2 Client part =============

// Main page
app.get('/', (req, res) => {
    const token = req.session.token;
    const loginChallenge = req.query.login_challenge;
    const loginError = req.query.error;

    // If there is a login_challenge, show the login form
    if (loginChallenge) {
        return res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Login - OAuth2</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 100px auto; padding: 20px; }
        .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h2 { color: #333; margin-bottom: 20px; }
        input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        button { width: 100%; background: #007bff; color: white; padding: 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
        button:hover { background: #0056b3; }
        .info { background: #f8f9fa; padding: 15px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; }
        .error { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Login</h2>
        ${loginError ? `<div class="error">${loginError}</div>` : ''}
        <form method="POST" action="/auth/login">
            <input type="hidden" name="challenge" value="${loginChallenge}">
            <input type="email" name="email" placeholder="Email" value="test@example.com" required>
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit">Login</button>
        </form>
    </div>
</body>
</html>
        `);
    }

    // Regular main page
    let content = `
<!DOCTYPE html>
<html>
<head>
    <title>OAuth2 Demo</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .button { background: #007bff; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; }
        .button:hover { background: #0056b3; }
        .token-info { background: #f8f9fa; padding: 20px; margin-top: 20px; border-radius: 4px; }
        pre { white-space: pre-wrap; word-wrap: break-word; }
        input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }
        .success { background: #d4edda; color: #155724; padding: 15px; border-radius: 4px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>OAuth2 Demo Application</h1>`;

    if (token) {
        // Decode JWT
        let claims = {};
        try {
            const parts = token.access_token.split('.');
            if (parts.length === 3) {
                claims = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            }
        } catch (e) {
            // Opaque token
        }

        content += `
        <div class="success">
            <h3>✅ You are logged in!</h3>
        </div>
        <div class="token-info">
            <p><strong>Access Token:</strong></p>
            <pre>${token.access_token}</pre>
            <p><strong>Token Type:</strong> ${token.token_type}</p>
            <p><strong>Expires In:</strong> ${token.expires_in} seconds</p>
            ${token.refresh_token ? `<p><strong>Refresh Token:</strong></p><pre>${token.refresh_token}</pre>` : ''}
            ${claims.sub ? `
            <hr>
            <h4>Information from token:</h4>
            <p><strong>User ID:</strong> ${claims.sub}</p>
            <p><strong>Email:</strong> ${claims.ext.traits?.email || 'N/A'}</p>
            <p><strong>Roles:</strong> ${JSON.stringify(claims.ext.traits?.roles || [])}</p>
            <p><strong>Scope:</strong> ${JSON.stringify(claims.scp)}</p>
            <p><strong>Issued At:</strong> ${new Date(claims.iat * 1000).toLocaleString()}</p>
            <p><strong>Expires At:</strong> ${new Date(claims.exp * 1000).toLocaleString()}</p>
            ` : ''}
        </div>

        <form action="/logout" method="post" style="margin-top: 20px;">
            <button type="submit" class="button" style="background: #dc3545;">Logout</button>
        </form>`;
    } else {
        content += `
        <p>This is a demo application for testing OAuth2 flow with Ory Hydra.</p>
        <p>Click the button below to start the authorization process.</p>
        <form action="/start-oauth" method="post">
            <label>Scopes (separated by space):</label>
            <input name="scope" value="openid offline users:read products:read orders:read" />
            <button type="submit" class="button">Start OAuth2 Authorization</button>
        </form>`;
    }

    content += `
    </div>
</body>
</html>`;

    res.send(content);
});

// Start OAuth2 flow
app.post('/start-oauth', (req, res) => {
    const scope = req.body.scope || 'openid offline';
    const state = crypto.randomBytes(16).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');

    // Save in session
    req.session.oauth = {state, verifier};
    req.session.save((err) => {
        if (err) {
            console.error('Session save error:', err);
        }
    });

    console.log('Starting OAuth flow:', {
        state,
        sessionID: req.sessionID,
        session: req.session
    });

    // Redirect to Hydra
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: scope,
        state: state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
    });

    const authUrl = `${HYDRA_PUBLIC_URL}/oauth2/auth?${params}`;
    console.log('Redirecting to:', authUrl);

    res.redirect(authUrl);
});

// OAuth2 callback
app.get('/callback', async (req, res) => {
    const {code, state, error, error_description} = req.query;

    console.log('Callback received:', {code: code?.substring(0, 10) + '...', state, error});
    console.log('Session oauth:', req.session.oauth);
    console.log('Session ID:', req.sessionID);

    if (error) {
        return res.send(`
            <div style="max-width: 600px; margin: 50px auto; padding: 20px;">
                <h2>Authorization Error</h2>
                <p><strong>Error:</strong> ${error}</p>
                <p><strong>Description:</strong> ${error_description || ''}</p>
                <a href="/">← Back</a>
            </div>
        `);
    }

    if (!req.session.oauth) {
        console.error('No OAuth session found');
        return res.status(400).send(`
            <div style="max-width: 600px; margin: 50px auto; padding: 20px;">
                <h2>Session Error</h2>
                <p>OAuth session not found. Please try again.</p>
                <a href="/">← Back</a>
            </div>
        `);
    }

    if (req.session.oauth.state !== state) {
        console.error('State mismatch:', {
            expected: req.session.oauth.state,
            received: state
        });
        return res.status(400).send(`
            <div style="max-width: 600px; margin: 50px auto; padding: 20px;">
                <h2>Security Error</h2>
                <p>Invalid state parameter</p>
                <p><small>Expected: ${req.session.oauth.state}</small></p>
                <p><small>Received: ${state}</small></p>
                <a href="/">← Back</a>
            </div>
        `);
    }

    try {
        // Exchange code for tokens - use INTERNAL URL for server-to-server
        const tokenResponse = await axios.post(
            `${HYDRA_INTERNAL_URL}/oauth2/token`,
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code_verifier: req.session.oauth.verifier
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        req.session.token = tokenResponse.data;
        delete req.session.oauth;

        res.redirect('/');
    } catch (error) {
        console.error('Token exchange error:', error.response?.data || error);
        res.status(500).send(`
            <div style="max-width: 600px; margin: 50px auto; padding: 20px;">
                <h2>Token Retrieval Error</h2>
                <pre>${JSON.stringify(error.response?.data || error.message, null, 2)}</pre>
                <a href="/">← Back</a>
            </div>
        `);
    }
});

// ============= Login/Consent Provider part =============

// Login handler
app.post('/auth/login', async (req, res) => {
    const {email, password, challenge} = req.body;

    try {
        // 1. Get login flow from Kratos
        const flowResp = await axios.get('http://kratos:4433/self-service/login/api');
        const flowId = flowResp.data.id;

        // 2. Submit login credentials to Kratos
        const kratosResponse = await axios.post(
            `http://kratos:4433/self-service/login?flow=${flowId}`,
            {
                method: 'password',
                identifier: email,
                password: password
            },
            {
                headers: {'Content-Type': 'application/json'}
            }
        );

        // If login is successful, use the entered email as subject
        const userId = email;

        // Save Kratos identity traits in session for consent
        if (kratosResponse.data && kratosResponse.data.session && kratosResponse.data.session.identity) {
            req.session.userTraits = kratosResponse.data.session.identity.traits;
        } else {
            req.session.userTraits = {email};
        }

        // Accept login in Hydra
        const acceptResponse = await axios.put(
            `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/login/accept?login_challenge=${challenge}`,
            {
                subject: userId,
                remember: true,
                remember_for: 3600,
                acr: '0'
            }
        );

        return res.redirect(acceptResponse.data.redirect_to);
    } catch (error) {
        let errorMsg = 'Login failed';
        if (error.response && error.response.data) {
            if (typeof error.response.data === 'string') {
                errorMsg = error.response.data;
            } else if (error.response.data.error && error.response.data.error.message) {
                errorMsg = error.response.data.error.message;
            } else if (error.response.data.message) {
                errorMsg = error.response.data.message;
            } else if (error.response.data.ui && error.response.data.ui.messages && error.response.data.ui.messages.length > 0) {
                errorMsg = error.response.data.ui.messages.map(m => m.text).join(' ');
            }
        }
        console.error('Login error:', error.response?.data || error);
        res.redirect(`/?login_challenge=${challenge}&error=${encodeURIComponent(errorMsg)}`);
    }
});

// Login endpoint for Hydra
app.get('/login', async (req, res) => {
    const {login_challenge} = req.query;

    if (!login_challenge) {
        // If no challenge, redirect to main
        return res.redirect('/');
    }

    // Redirect to main with challenge
    res.redirect(`/?login_challenge=${login_challenge}`);
});

// Consent endpoint - automatically grant consent
app.get('/consent', async (req, res) => {
    const {consent_challenge} = req.query;

    if (!consent_challenge) {
        return res.status(400).send('Missing consent_challenge');
    }

    try {
        // Get consent request
        const consentRequest = await axios.get(
            `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/consent?consent_challenge=${consent_challenge}`
        );

        // Use user traits from session if available
        const userTraits = req.session.userTraits || {
            email: 'test@example.com',
            name: 'Test User',
            roles: ['admin', 'user']
        };

        // Accept consent
        const acceptResponse = await axios.put(
            `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/consent/accept?consent_challenge=${consent_challenge}`,
            {
                grant_scope: consentRequest.data.requested_scope,
                grant_access_token_audience: consentRequest.data.requested_access_token_audience,
                remember: true,
                remember_for: 3600,
                session: {
                    access_token: {
                        email: userTraits.email,
                        traits: userTraits
                    },
                    id_token: {
                        email: userTraits.email,
                        name: userTraits.name,
                        traits: userTraits
                    }
                }
            }
        );

        return res.redirect(acceptResponse.data.redirect_to);
    } catch (error) {
        console.error('Consent error:', error.response?.data || error);
        res.status(500).send('Consent error');
    }
});

// ============= Additional endpoints =============

// Logout
app.post('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(port, () => {
    console.log(`All-in-One OAuth2 App running at http://localhost:${port}`);
    console.log('This app serves as:');
    console.log('  - OAuth2 Client');
    console.log('  - Login Provider');
    console.log('  - Consent Provider');
});
```

Теперь создадим `Dockerfile` для этой страницы:

```dockerfile
FROM node:18-alpine
WORKDIR /app
RUN npm install express axios express-session crypto
COPY . .
EXPOSE 3001
CMD ["node", "index.js"]
```

Теперь добавим сервис в `docker-compose.yml`:

```yaml
  hydra-token-page:
    build:
      context: ./docker/hydra
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    networks:
      - intranet
```

Теперь у нас есть страница для получения токена доступа, которую мы можем использовать для тестирования. Запускаем
`docker-compose up -d`, после чего можем перейти по адресу `http://127.0.1:3001` и видим страницу для получения токена.

Теперь зарегестрируем клиента.

```bash
curl -X POST http://localhost:4445/admin/clients \
  -H 'Content-Type: application/json' \
  -d '{
      "client_id": "web",
      "client_secret": "**web-secret**",
      "grant_types": ["authorization_code", "refresh_token"],
      "response_types": ["code", "id_token"],
      "scope": "openid offline users:read products:read orders:read",
      "redirect_uris": ["http://127.0.0.1:4455/callback"]
  }'
```

`redirect_uris` указывает на Kratos‑UI (порт 4455), который мы уже подняли. `offline` даёт refresh‑token, чтобы не
логиниться каждый час.

![Клиент успешно зарегистрирован](./img/3_client_registered.png)

Теперь добавим роль пользователю, которого мы создали в Ory Kratos. Но просто добавить не можем, нам нужно модифировать
схему которую мы добавляли при создании Kratos. Лежит в папке `docker/kratos/configs/identity.schema.json`, там мы
добавляем новое свойство `roles`, сразу после `names`:

```json
{
  "roles": {
    "type": "array",
    "items": {
      "type": "string"
    },
    "description": "Список ролей пользователя, например: admin, user, moderator"
  }
}
```

Перезагружаем контейнер не нужно, применяется сразу. Дальше идем получать ID identity, его можно получить на вкладе
`http://127.0.0.1:4455/sessions`. У
меня это `90a1e7d9-82ad-4f71-a1ab-f88ca81fd2e5` (будьте внимательны, id указывается в identity -> ID, а не первая
строка). После чего отправляем запрос на добавление роли:

```bash
curl -X PATCH http://localhost:4434/admin/identities/90a1e7d9-82ad-4f71-a1ab-f88ca81fd2e5 \
  -H 'Content-Type: application/json' \
  -u '[
  {
    "op": "add",
    "path": "/traits/roles/-",
    "value": "admin"
  }
]'
```

![Роль успешно добавлена](./img/4_role_added.png)

Теперь получаем токен доступа, что бы протестировать. Идем на нашу страницу `http://127.0.0.1:3001`, вводим
логин и пароль, после чего нажимаем "Login". После успешной аутентификации, вы увидете свой токен, а так же
роли и scope, которые были указаны.

![Токен успешно получен](./img/5_token_received.png)

Проверяем что токен валидный:

```bash
curl -X POST http://127.0.0.1:4444/userinfo \
  -d 'token=ВАШ_ТОКЕН'
````

Теперь идем настраивать Apache APISIX. Для этого нам нужно создать три наших маршрута.
Показываю для одного, вам достаточно будет изменить `uri` и `upstream`.

```bash
curl -X PUT http://localhost:9180/apisix/admin/routes/users \
  -H "X-API-KEY: supersecret" \
  -d '{
  "uri": "/users/*",
  "plugins": {
    "openid-connect": {
      "client_id": "web",
      "client_secret": "web-secret",
      "discovery": "http://hydra:4444/.well-known/openid-configuration",
      "bearer_only": true,
      "use_jwks": true,
      "token_signing_alg_values_expected": "RS256"
      }
    },
    "proxy-rewrite": {
      "regex_uri": ["^/users/?(.*)", "/$1"]
    }
  },
  "upstream": {
    "type": "roundrobin",
    "nodes": {
      "users:8080": 1
    }
  }
}'
```

И если попытаем сделать запрос на ручку, то получим ответ:

```bash
2025/06/25 19:14:16 [warn] 63#63: *2352793 [lua] openid-connect.lua:435: introspect(): OIDC access discovery url failed : accessing discovery url (http://127.0.0.1:4444/.well-known/openid-configuration) failed: connection refused, client: 192.168.148.1, server: _, request: "GET /users/123 HTTP/1.1", host: "localhost:9080"
2025-06-25T19:14:16.273643707Z 2025/06/25 19:14:16 [error] 63#63: *2352793 [lua] openidc.lua:573: openidc_discover(): accessing discovery url (http://127.0.0.1:4444/.well-known/openid-configuration) failed: connection refused, client: 192.168.148.1, server: _, request: "GET /users/123 HTTP/1.1", host: "localhost:9080"
2025-06-25T19:14:16.273652832Z 2025/06/25 19:14:16 [error] 63#63: *2352793 [lua] openidc.lua:1006: openidc_load_jwt_and_verify_crypto(): accessing discovery url (http://127.0.0.1:4444/.well-known/openid-configuration) failed: connection refused, client: 192.168.148.1, server: _, request: "GET /users/123 HTTP/1.1", host: "localhost:9080"
```

Проблема в том, что APISIX пытается обратиться к Hydra по адресу `http://127.0.1:4444`, а Hydra работает в контейнере и
не доступна по этому адресу изнутри. Но если мы поменяем issuer на hydra, то мы не сможем получить токен, так как этот
адрес не доступен из браузера. Самый простой способ - это добавить в файл `/etc/hosts` на вашей машине строку:

```
127.0.0.1	hydra
```

После этого поменять в конфиге Hydra `docker/hydra/config/hydra.yml` значение `issuer` на `http://hydra:4444`. И в
запросе
на регистрацию клиента указать `redirect_uris` как `http://hydra:4444/callback`. Так же меняем env в нашем
hydra-token-page. Затем перейти в брайзер и получить новый токен.
После этого APISIX сможет коректно прокинуть запросы.

![Результат запроса](./img/6_result.png)

## Проверка ролей

У нас все настроено, мы можем отправлять запросы к нашим микросервисам, но нам нужно проверить, что у нас есть
соотвествующая роль.
Так как изначально статья иследовательская, ожидал что APISIX сможет это сделать, ждем когда
примут [PR #11824](https://github.com/apache/apisix/pull/11824).

С помощью него можно будет сделать что-то вроде:

```json
{
  "claim_validator": {
    "roles": {
      "claim": "ext.traits.roles",
      "match": "any",
      "value": [
        "orders"
      ]
    }
  }
}
```

Потом я решил пойти в сторону добавления ролей в виде scope, например 'roles:order', но тут тоже оказалась проблема.
Hydra хранит scope в `scp` в токене, а APISIX умеет брать данные только в scope, если мы добавляем проверку:

```json
{
  "required_scopes": [
    "roles:order"
  ]
}
```

Поэтому если у вас система отдает JWT, то это рабочий вариант, но если вы используете Hydra, то тогда мы сразу
отказываемся от JWT и переходим на opaque токены. Для этого нужно в конфиге Hydra указать

```yaml
strategies:
  access_token: opaque
```

После этого заходим на наш сайт, перевыпускаем токен, а дальше проверяем:

```bash
curl --request POST \
     --url http://localhost:4445/oauth2/introspect \
     --header "Content-Type: application/x-www-form-urlencoded" \
     --user "web:web-secret" \
     --data-urlencode "token=<ТВОЙ_ТОКЕН>"
```

![Результат запроса](./img/7_introspect.png)

Здесь уже по-человечески написано scope, а не scp. Теперь мы можем использовать APISIX для проверки ролей.

```bash
curl -X PUT http://localhost:9180/apisix/admin/routes/orders \
  -H "X-API-KEY: supersecret" \
  -d '{
  "uri": "/users/*",
  "plugins": {
    "openid-connect": {
      "client_id": "web",
      "client_secret": "web-secret",
      "discovery": "http://hydra:4444/.well-known/openid-configuration",
      "bearer_only": true,
      "introspection_endpoint": "http://hydra:4445/admin/oauth2/introspect",
      "required_scopes": ["roles:order"]
    },
    "proxy-rewrite": {
      "regex_uri": ["^/users/?(.*)", "/$1"]
    }
  },
  "upstream": {
    "type": "roundrobin",
    "nodes": {
      "users:8080": 1
    }
  }
}'
```

![Результат запроса](./img/8_result.png)

Теперь меняем на `roles:users` и видим что ручка не доступна:

![Результат запроса](./img/9_result.png)

## Проверка прав в микросервисах

Теперь мы можем проверять уже детальные права в рамках микросервиса. Для этого мы можем использовать middleware.

Микросервис пользователя у нас будет выглядеть следующим образом:

```go
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gorilla/mux"
)

type UserInfo struct {
	Sub      string `json:"sub"`
	Scope    string `json:"scope"`
	ClientID string `json:"client_id"`
	Active   bool   `json:"active"`
}

func AuthMiddleware(requiredScopes ...string) mux.MiddlewareFunc {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userInfoHeader := r.Header.Get("X-Userinfo")
			if userInfoHeader == "" {
				http.Error(w, "Unauthorized: Missing user info", http.StatusUnauthorized)
				return
			}

			decoded, err := base64.StdEncoding.DecodeString(userInfoHeader)
			if err != nil {
				http.Error(w, "Unauthorized: Invalid user info format", http.StatusUnauthorized)
				return
			}

			var userInfo UserInfo
			if err := json.Unmarshal(decoded, &userInfo); err != nil {
				http.Error(w, "Unauthorized: Invalid user info JSON", http.StatusUnauthorized)
				return
			}

			if !userInfo.Active {
				http.Error(w, "Unauthorized: Token is not active", http.StatusUnauthorized)
				return
			}

			userScopes := strings.Split(userInfo.Scope, " ")

			if !hasRequiredScopes(userScopes, requiredScopes) {
				http.Error(w, "Forbidden: Insufficient permissions", http.StatusForbidden)
				return
			}

			r.Header.Set("X-User-ID", userInfo.Sub)
			r.Header.Set("X-User-Scopes", userInfo.Scope)
			r.Header.Set("X-Client-ID", userInfo.ClientID)

			next.ServeHTTP(w, r)
		})
	}
}

func hasRequiredScopes(userScopes, requiredScopes []string) bool {
	scopeMap := make(map[string]bool)
	for _, scope := range userScopes {
		scopeMap[scope] = true
	}

	for _, required := range requiredScopes {
		if !scopeMap[required] {
			return false
		}
	}
	return true
}

func getUserInfo(r *http.Request) (string, []string) {
	userID := r.Header.Get("X-User-ID")
	scopes := strings.Split(r.Header.Get("X-User-Scopes"), " ")
	return userID, scopes
}

func main() {
	r := mux.NewRouter()
	service := os.Getenv("SERVICE_NAME")

	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "%s service is healthy!", service)
	}).Methods("GET")

	r.Handle("/", AuthMiddleware("users:read")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, scopes := getUserInfo(r)
		fmt.Fprintf(w, "Hello from %s service! User: %s, Scopes: %v", service, userID, scopes)
	}))).Methods("GET")

	r.Handle("/", AuthMiddleware("users:write")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, _ := getUserInfo(r)
		fmt.Fprintf(w, "Create in %s service by user %s!", service, userID)
	}))).Methods("POST")

	r.Handle("/{id}", AuthMiddleware("users:read")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		userID, _ := getUserInfo(r)
		fmt.Fprintf(w, "Read %s with id %s by user %s!", service, vars["id"], userID)
	}))).Methods("GET")

	r.Handle("/{id}", AuthMiddleware("users:write")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		userID, _ := getUserInfo(r)
		fmt.Fprintf(w, "Update %s with id %s by user %s!", service, vars["id"], userID)
	}))).Methods("PUT")

	r.Handle("/{id}", AuthMiddleware("users:delete")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		userID, _ := getUserInfo(r)
		fmt.Fprintf(w, "Delete %s with id %s by user %s!", service, vars["id"], userID)
	}))).Methods("DELETE")

	r.Handle("/admin/stats", AuthMiddleware("admin:read", "users:read")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, scopes := getUserInfo(r)
		fmt.Fprintf(w, "Admin stats for %s service. Admin: %s, Scopes: %v", service, userID, scopes)
	}))).Methods("GET")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting %s service on port %s", service, port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
```

Теперь если отправим POST запрос на `/users` то получим ответ `Forbidden: Insufficient permissions`:

![Результат запроса](./img/10_result.png)

## Заключение

В рамках этой статьи мы разобрали два основных подхода к реализации авторизации и аутентификации в микросервисной
архитектуре. Первый подход с JWT токенами подходит для простых систем с базовыми ролями, но имеет ограничения по размеру
заголовков. Второй подход с opaque токенами и интроспекцией позволяет реализовать более гибкую систему разрешений, но
добавляет сетевые накладные расходы.
Мы успешно интегрировали Ory Kratos для аутентификации и Ory Hydra для авторизации, настроили Apache APISIX в качестве
API Gateway и создали middleware для проверки детальных разрешений в микросервисах. Такая архитектура дает нам:

* Централизованное управление доступом через API Gateway
* Гибкую систему разрешений на уровне отдельных операций
* Масштабируемость за счет микросервисной архитектуры Ory
* Безопасность через использование стандартных протоколов OAuth2/OIDC

В продакшене не забудьте:

* Использовать HTTPS для всех соединений
* Настроить надежные пароли и секреты
* Добавить мониторинг и логирование
* Настроить кэширование результатов интроспекции
* Продумать стратегию ротации токенов

Весь код из статьи доступен в [репозитории на GitHub](https://github.com/nemirlev/auth-service-example), где вы можете
поэкспериментировать с разными настройками и
адаптировать решение под свои нужды.

P.S. Пока готовил статью, так как она достаточно исследовательская, понял что проще всего вообще микросервисы держать
открытими, а авторизацию делать только на уровне API Gateway.

P.P.S. Сильно чаще чем статьи я пишу в [своем канале в ТГ](https://t.me/bodrcoder), подписывайтесь.

