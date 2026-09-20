package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterNovelRoutes 注册漫画模块的小说检索与资料库配置接口。
// 检索属于强校验写路径的前置步骤，必须登录，且只返回摘要级候选。
func RegisterNovelRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/novels/search", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.NovelSearchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		configured, err := svc.NovelLibraryConfigured()
		if err != nil {
			failService(c, err)
			return
		}
		if !configured {
			ok(c, gin.H{"results": []service.NovelSearchResult{}, "libraryConfigured": false})
			return
		}
		results, err := svc.SearchNovels(c.Request.Context(), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"results": results, "libraryConfigured": true})
	})

	r.GET("/admin/settings/novel-library", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.AdminNovelLibrarySetting(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})

	r.PATCH("/admin/settings/novel-library", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req service.NovelLibrarySettingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		setting, err := svc.UpdateNovelLibrarySetting(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
}
