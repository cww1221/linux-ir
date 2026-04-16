package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

type AIProvider string

const (
	AIProviderNone   AIProvider = "none"
	AIProviderOllama AIProvider = "ollama"
	AIProviderOpenAI AIProvider = "openai_compatible"
)

type Settings struct {
	AIProvider      AIProvider `json:"aiProvider"`
	OllamaBaseURL   string     `json:"ollamaBaseUrl"`
	OllamaModel     string     `json:"ollamaModel"`
	OpenAIBaseURL   string     `json:"openaiBaseUrl"`
	OpenAIAPIKey    string     `json:"openaiApiKey"`
	OpenAIModel     string     `json:"openaiModel"`
	MaxParallelExec int        `json:"maxParallelExec"`
}

func DefaultSettings() Settings {
	return Settings{
		AIProvider:      AIProviderOllama,
		OllamaBaseURL:   "http://127.0.0.1:11434",
		OllamaModel:     "",
		OpenAIBaseURL:   "https://api.openai.com/v1",
		OpenAIAPIKey:    "",
		OpenAIModel:     "gpt-4.1-mini",
		MaxParallelExec: 10,
	}
}

type Store struct {
	mu   sync.Mutex
	path string
}

func NewStore(appName string) (*Store, error) {
	if appName == "" {
		return nil, errors.New("appName 不能为空")
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	p := filepath.Join(dir, appName, "settings.json")
	return &Store{path: p}, nil
}

func (s *Store) Load() (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	def := DefaultSettings()
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return def, nil
		}
		return def, err
	}
	var cfg Settings
	if err := json.Unmarshal(b, &cfg); err != nil {
		return def, err
	}
	if cfg.AIProvider == "" {
		cfg.AIProvider = def.AIProvider
	}
	if cfg.OllamaBaseURL == "" {
		cfg.OllamaBaseURL = def.OllamaBaseURL
	}
	if cfg.OpenAIBaseURL == "" {
		cfg.OpenAIBaseURL = def.OpenAIBaseURL
	}
	if cfg.OpenAIModel == "" {
		cfg.OpenAIModel = def.OpenAIModel
	}
	if cfg.MaxParallelExec <= 0 {
		cfg.MaxParallelExec = def.MaxParallelExec
	}
	return cfg, nil
}

func (s *Store) Save(cfg Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0o600)
}

