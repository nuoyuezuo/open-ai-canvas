package handler

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestWelcomeAvailabilityPublicRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterFeatureAvailabilityRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	for _, enabled := range []bool{true, false, true} {
		payload, _ := json.Marshal(map[string]bool{"welcomeEnabled": enabled})
		if err := db.Save(&model.SystemSetting{Key: "feature_availability", ValueJSON: string(payload)}).Error; err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/public/welcome", nil))
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("unexpected public response: %d %s", response.Code, response.Body.String())
		}
		var body struct {
			Code int             `json:"code"`
			Data map[string]bool `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Code != 0 || len(body.Data) != 1 || body.Data["welcomeEnabled"] != enabled {
			t.Fatalf("unexpected public payload: %s", response.Body.String())
		}
	}
}

// TestAdminFeatureAvailabilityReturnsComicFlagsForLegacySetting 覆盖功能开放面板打不开的回归：
// 库内已有不含 comicEnabled / comicDramaEnabled 的旧配置时，管理端接口仍必须返回完整布尔字段，
// 否则前端解析会整体抛错、页面只显示“无法读取功能开放配置”。
func TestAdminFeatureAvailabilityReturnsComicFlagsForLegacySetting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.User{}, &model.AuthSession{}); err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	svc := service.New(repo, t.TempDir())

	admin := model.User{ID: "admin-1", Username: "admin", Role: "admin", Status: "active"}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	token := "session-token"
	// 会话校验比对的是 sha256 十六进制摘要，这里直接按同一算法构造，避免依赖未导出的辅助函数。
	sum := sha256.Sum256([]byte(token))
	if err := db.Create(&model.AuthSession{
		ID: "session-1", UserID: admin.ID, TokenHash: fmt.Sprintf("%x", sum[:]), ExpiresAt: time.Now().Add(time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}

	legacy := `{"welcomeEnabled":true,"shortDramaEnabled":false,"taskCenterEnabled":false,"creditsEnabled":false,"customChannelsEnabled":false,"frontendModelsEnabled":false,"pluginCenterEnabled":false,"systemPluginsVisibleToUsers":false}`
	if err := db.Save(&model.SystemSetting{Key: "feature_availability", ValueJSON: legacy}).Error; err != nil {
		t.Fatal(err)
	}

	router := gin.New()
	RegisterFeatureAvailabilityRoutes(router.Group("/api"), svc)
	request := httptest.NewRequest(http.MethodGet, "/api/admin/settings/features", nil)
	request.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "session-1." + token})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d %s", response.Code, response.Body.String())
	}
	var body struct {
		Code int `json:"code"`
		Data struct {
			Features map[string]any `json:"features"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != 0 {
		t.Fatalf("unexpected payload: %s", response.Body.String())
	}
	for _, key := range []string{"shortDramaEnabled", "comicEnabled", "comicDramaEnabled", "taskCenterEnabled", "creditsEnabled", "customChannelsEnabled", "frontendModelsEnabled", "pluginCenterEnabled", "systemPluginsVisibleToUsers"} {
		if _, ok := body.Data.Features[key].(bool); !ok {
			t.Fatalf("管理端响应缺少布尔字段 %s: %s", key, response.Body.String())
		}
	}
	if body.Data.Features["comicEnabled"] != true || body.Data.Features["comicDramaEnabled"] != true {
		t.Fatalf("旧配置下漫画开关应回填默认开放: %s", response.Body.String())
	}
}
