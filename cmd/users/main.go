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
