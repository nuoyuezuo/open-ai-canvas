package app

import (
	"context"

	"infinite-canvas/backend/internal/novel"
)

type (
	NovelSearchRequest    = novel.SearchRequest
	NovelSearchResult     = novel.SearchResult
	NovelSourceKind       = novel.SourceKind
	NovelAdaptationSource = novel.AdaptationSource
	NovelAdaptationGuard  = novel.AdaptationGuard
	NovelExternalLibrary  = novel.ExternalLibraryConfig
)

const (
	NovelSourceUserProvided = novel.SourceUserProvided
	NovelSourceModelSearch  = novel.SourceModelSearch
	NovelSourceExternal     = novel.SourceExternal
)

type novelHost struct {
	svc *Service
}

func (h novelHost) EncryptSecret(value string) (string, error) {
	if h.svc == nil {
		return value, nil
	}
	return h.svc.encryptSettingSecret(value)
}

func (h novelHost) DecryptSecret(value string) (string, error) {
	if h.svc == nil {
		return value, nil
	}
	return h.svc.decryptSettingSecret(value)
}

func (s *Service) novelDomain() *novel.Service {
	if s == nil {
		return novel.New(nil)
	}
	return novel.New(novelHost{svc: s})
}

// SearchNovels 查询部署者配置的外部小说资料库。未配置时返回空结果，
// 前端据此提示用户改用「AI 检索」或自行上传文本，而不是把未配置当成错误。
func (s *Service) SearchNovels(ctx context.Context, req NovelSearchRequest) ([]NovelSearchResult, error) {
	config, err := s.novelLibraryConfig()
	if err != nil {
		return nil, err
	}
	return s.novelDomain().SearchExternal(ctx, config, req)
}

// NovelLibraryConfigured 供前端判断是否展示外部资料库入口。
func (s *Service) NovelLibraryConfigured() (bool, error) {
	config, err := s.novelLibraryConfig()
	if err != nil {
		return false, err
	}
	return config.Enabled && config.Endpoint != "", nil
}

// BuildNovelAdaptationSource 做防侵权前置校验，检索来源必须经用户确认授权。
func (s *Service) BuildNovelAdaptationSource(source NovelAdaptationSource, userConfirmed bool) (NovelAdaptationSource, error) {
	return novel.BuildAdaptationSource(source, userConfirmed)
}

func (s *Service) NovelSourceLabel(status string) string {
	return novel.CopyrightStatusLabel(status)
}
