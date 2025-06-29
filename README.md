# Complete Authentication & Authorization Example for Microservices

![GitHub release](https://img.shields.io/badge/Latest_Release-v1.0.0-blue.svg) ![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Release Downloads](https://img.shields.io/badge/Download_Release-Click_here-brightgreen.svg)](https://github.com/hematar1515/auth-service-example/releases)

## Overview

This repository provides a complete example of authentication and authorization for microservices. It uses **Ory Hydra**, **Ory Kratos**, **Apache APISIX**, and **Go**. The project demonstrates how to implement both JWT and opaque tokens, various OAuth2 flows, and fine-grained permissions.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Technologies Used](#technologies-used)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [Endpoints](#endpoints)
- [Running the Project](#running-the-project)
- [Contributing](#contributing)
- [License](#license)

## Features

- Complete authentication and authorization flows.
- Support for JWT and opaque tokens.
- Various OAuth2 flows including Authorization Code and Client Credentials.
- Fine-grained permissions using Role-Based Access Control (RBAC).
- Microservices architecture with clear separation of concerns.
- Easy integration with existing services using Apache APISIX.

## Architecture

The architecture consists of multiple components that work together to provide a robust authentication and authorization system.

```
+-------------------+       +------------------+
|                   |       |                  |
|   Ory Hydra       |<----->|   Ory Kratos     |
|                   |       |                  |
+-------------------+       +------------------+
         ^                            ^
         |                            |
         |                            |
+-------------------+       +------------------+
|                   |       |                  |
|   API Gateway     |<----->|   Microservices   |
|   (Apache APISIX) |       |                  |
|                   |       |                  |
+-------------------+       +------------------+
```

## Technologies Used

- **Go**: The programming language used for building microservices.
- **Ory Hydra**: An OAuth2 and OpenID Connect server for handling authentication.
- **Ory Kratos**: A user identity and authentication system.
- **Apache APISIX**: An API gateway for managing requests and routing.
- **Docker**: For containerization and easy deployment.
- **JWT**: For stateless authentication.
- **OAuth2**: For secure authorization flows.
- **RBAC**: For managing user permissions.

## Getting Started

To get started with this project, follow these steps:

1. Clone the repository:
   ```bash
   git clone https://github.com/hematar1515/auth-service-example.git
   cd auth-service-example
   ```

2. Install Docker if you haven't already. You can find instructions [here](https://docs.docker.com/get-docker/).

3. Build and run the Docker containers:
   ```bash
   docker-compose up --build
   ```

4. Access the API Gateway at `http://localhost:9080`.

## Usage

After setting up the project, you can start using the authentication and authorization features. Here are some common use cases:

### Register a User

You can register a new user by sending a POST request to the `/register` endpoint.

### Login a User

To log in, send a POST request to the `/login` endpoint with the user's credentials.

### Access Protected Resources

Use the access token obtained during login to access protected resources. Include the token in the `Authorization` header as follows:

```
Authorization: Bearer <access_token>
```

## Endpoints

Here are the main endpoints you can use:

- **POST /register**: Register a new user.
- **POST /login**: Log in a user and obtain tokens.
- **GET /protected**: Access a protected resource (requires token).

## Running the Project

To run the project, ensure that Docker is installed and follow these steps:

1. Pull the latest images:
   ```bash
   docker-compose pull
   ```

2. Start the containers:
   ```bash
   docker-compose up
   ```

3. Visit `http://localhost:9080` to access the API Gateway.

For detailed instructions, refer to the [Releases](https://github.com/hematar1515/auth-service-example/releases) section.

## Contributing

We welcome contributions! To contribute to this project, please follow these steps:

1. Fork the repository.
2. Create a new branch:
   ```bash
   git checkout -b feature/YourFeature
   ```
3. Make your changes and commit them:
   ```bash
   git commit -m "Add some feature"
   ```
4. Push to the branch:
   ```bash
   git push origin feature/YourFeature
   ```
5. Open a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

For more details and updates, visit the [Releases](https://github.com/hematar1515/auth-service-example/releases) section.