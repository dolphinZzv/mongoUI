package automation

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"mongoui/internal/config"
)

// Store keeps automation configuration in the coordination MongoDB when a
// lease is available, so every instance sees the same alert/runbook rules.
// Without a lease it falls back to the local settings file (single instance).
type Store struct {
	settings *config.Settings
	coll     *mongo.Collection
}

func NewStore(settings *config.Settings, lease *Lease) *Store {
	store := &Store{settings: settings}
	if lease != nil {
		store.coll = lease.Collection("automation")
	}
	return store
}

type automationDoc struct {
	Alerts   []config.AlertRule  `bson:"alerts"`
	Runbooks []config.Runbook    `bson:"runbooks"`
	SMTP     config.SMTPSettings `bson:"smtp"`
}

func (s *Store) load() (automationDoc, error) {
	var doc automationDoc
	if s.coll == nil {
		return doc, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := s.coll.FindOne(ctx, bson.M{"_id": "config"}).Decode(&doc)
	if err == mongo.ErrNoDocuments {
		return doc, nil
	}
	return doc, err
}

func (s *Store) update(field string, value any) error {
	if s.coll == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := s.coll.UpdateOne(ctx,
		bson.M{"_id": "config"},
		bson.M{"$set": bson.M{field: value}},
		options.Update().SetUpsert(true),
	)
	return err
}

func (s *Store) GetAlerts() ([]config.AlertRule, error) {
	if s.coll == nil {
		return s.settings.GetAlerts()
	}
	doc, err := s.load()
	if err != nil {
		return nil, err
	}
	for i := range doc.Alerts {
		if doc.Alerts[i].WebhookSecret, err = s.settings.DecryptSecret(doc.Alerts[i].WebhookSecret); err != nil {
			return nil, err
		}
	}
	return doc.Alerts, nil
}

func (s *Store) SetAlerts(rules []config.AlertRule) error {
	if s.coll == nil {
		return s.settings.SetAlerts(rules)
	}
	encrypted := make([]config.AlertRule, len(rules))
	copy(encrypted, rules)
	for i := range encrypted {
		secret, err := s.settings.EncryptSecret(encrypted[i].WebhookSecret)
		if err != nil {
			return err
		}
		encrypted[i].WebhookSecret = secret
	}
	return s.update("alerts", encrypted)
}

func (s *Store) GetRunbooks() []config.Runbook {
	if s.coll == nil {
		return s.settings.GetRunbooks()
	}
	doc, err := s.load()
	if err != nil {
		return nil
	}
	return doc.Runbooks
}

func (s *Store) SetRunbooks(runbooks []config.Runbook) error {
	if s.coll == nil {
		return s.settings.SetRunbooks(runbooks)
	}
	return s.update("runbooks", runbooks)
}

func (s *Store) GetSMTP() (config.SMTPSettings, error) {
	if s.coll == nil {
		return s.settings.GetSMTP()
	}
	doc, err := s.load()
	if err != nil {
		return config.SMTPSettings{}, err
	}
	if doc.SMTP.Password != "" {
		doc.SMTP.Password, err = s.settings.DecryptSecret(doc.SMTP.Password)
	}
	return doc.SMTP, err
}

func (s *Store) SetSMTP(cfg config.SMTPSettings) error {
	if s.coll == nil {
		return s.settings.SetSMTP(cfg)
	}
	encrypted, err := s.settings.EncryptSecret(cfg.Password)
	if err != nil {
		return err
	}
	cfg.Password = encrypted
	return s.update("smtp", cfg)
}
