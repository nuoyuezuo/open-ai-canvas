package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/novel"

	"gorm.io/gorm"
)

const novelLibrarySettingKey = "novel_library"

// NovelLibrarySettingRequest 是管理员配置的外部小说资料库。
type NovelLibrarySettingRequest struct {
	Enabled     bool              `json:"enabled"`
	Endpoint    string            `json:"endpoint"`
	APIKey      string            `json:"apiKey"`
	Label       string            `json:"label"`
	LicenseNote string            `json:"licenseNote"`
	Headers     map[string]string `json:"headers"`
}

type PublicNovelLibrarySetting struct {
	Enabled     bool              `json:"enabled"`
	Endpoint    string            `json:"endpoint"`
	Label       string            `json:"label"`
	LicenseNote string            `json:"licenseNote"`
	Headers     map[string]string `json:"headers"`
	HasAPIKey   bool              `json:"hasApiKey"`
	UpdatedBy   string            `json:"updatedBy,omitempty"`
	CreatedAt   time.Time         `json:"createdAt,omitempty"`
	UpdatedAt   time.Time         `json:"updatedAt,omitempty"`
}

type novelLibrarySettingValue struct {
	Enabled     bool              `json:"enabled"`
	Endpoint    string            `json:"endpoint"`
	APIKey      string            `json:"apiKey"`
	Label       string            `json:"label"`
	LicenseNote string            `json:"licenseNote"`
	Headers     map[string]string `json:"headers"`
}

func (s *Service) AdminNovelLibrarySetting(actor *model.User) (*PublicNovelLibrarySetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readNovelLibrarySetting()
	if err != nil {
		return nil, err
	}
	public := publicNovelLibrarySetting(setting, value)
	return &public, nil
}

func (s *Service) UpdateNovelLibrarySetting(actor *model.User, req NovelLibrarySettingRequest) (*PublicNovelLibrarySetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	currentSetting, current, err := s.readNovelLibrarySetting()
	if err != nil {
		return nil, err
	}
	next, err := s.novelLibrarySettingFromRequest(req, current)
	if err != nil {
		return nil, err
	}
	setting := &model.SystemSetting{Key: novelLibrarySettingKey, UpdatedBy: actor.ID}
	if currentSetting != nil {
		setting.CreatedAt = currentSetting.CreatedAt
	}
	encoded, err := json.Marshal(next)
	if err != nil {
		return nil, err
	}
	setting.ValueJSON = string(encoded)
	if err := s.repo.SaveSystemSetting(setting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "novel_library.update", "system_setting", novelLibrarySettingKey, "更新小说检索资料库", map[string]any{"before": publicNovelLibrarySetting(currentSetting, current), "after": publicNovelLibrarySetting(setting, next)}); err != nil {
		return nil, err
	}
	public := publicNovelLibrarySetting(setting, next)
	return &public, nil
}

// novelLibrarySettingFromRequest 保留已存密钥：前端只提交 hasApiKey，不回传明文。
func (s *Service) novelLibrarySettingFromRequest(req NovelLibrarySettingRequest, current novelLibrarySettingValue) (novelLibrarySettingValue, error) {
	next := novelLibrarySettingValue{
		Enabled:     req.Enabled,
		Endpoint:    strings.TrimSpace(req.Endpoint),
		Label:       strings.TrimSpace(req.Label),
		LicenseNote: strings.TrimSpace(req.LicenseNote),
		Headers:     req.Headers,
	}
	if len(next.Headers) > 16 {
		return novelLibrarySettingValue{}, BadAuthRequest("自定义请求头最多 16 项")
	}
	if next.Enabled {
		if next.Endpoint == "" {
			return novelLibrarySettingValue{}, BadAuthRequest("启用外部小说资料库时必须填写接口地址")
		}
		if _, err := ValidateOutboundURL(next.Endpoint); err != nil {
			return novelLibrarySettingValue{}, err
		}
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		next.APIKey = current.APIKey
		return next, nil
	}
	encrypted, err := s.encryptSettingSecret(apiKey)
	if err != nil {
		return novelLibrarySettingValue{}, err
	}
	next.APIKey = encrypted
	return next, nil
}

func (s *Service) readNovelLibrarySetting() (*model.SystemSetting, novelLibrarySettingValue, error) {
	setting, err := s.repo.SystemSetting(novelLibrarySettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, novelLibrarySettingValue{}, nil
	}
	if err != nil {
		return nil, novelLibrarySettingValue{}, err
	}
	var value novelLibrarySettingValue
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, novelLibrarySettingValue{}, errors.New("小说资料库配置格式无效")
	}
	return setting, value, nil
}

// novelLibraryConfig 组装检索域配置，密钥在域包内解密，不经过 HTTP 层。
func (s *Service) novelLibraryConfig() (novel.ExternalLibraryConfig, error) {
	_, value, err := s.readNovelLibrarySetting()
	if err != nil {
		return novel.ExternalLibraryConfig{}, err
	}
	return novel.ExternalLibraryConfig{
		Enabled:     value.Enabled,
		Endpoint:    value.Endpoint,
		APIKey:      value.APIKey,
		Label:       value.Label,
		LicenseNote: value.LicenseNote,
		Headers:     value.Headers,
	}, nil
}

func publicNovelLibrarySetting(setting *model.SystemSetting, value novelLibrarySettingValue) PublicNovelLibrarySetting {
	result := PublicNovelLibrarySetting{
		Enabled:     value.Enabled,
		Endpoint:    value.Endpoint,
		Label:       value.Label,
		LicenseNote: value.LicenseNote,
		Headers:     value.Headers,
		HasAPIKey:   strings.TrimSpace(value.APIKey) != "",
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}
