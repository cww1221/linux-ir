package passwordcrypt

import (
	"strings"
	"testing"

	"github.com/GehirnInc/crypt"
	_ "github.com/GehirnInc/crypt/sha512_crypt"
)

func TestNormalizeShadowLine(t *testing.T) {
	line := "root:$6$yvSXpdkBPXnhkM2d$kEsoogTZM2iGM6EKlVrTgUHTliCej1/qhueAlrovPg5lkIGPS3QHdrsaaMJ/PYG0ofOni8qu9/51lAgwqIyME.::0:99999:7:::"
	h, err := NormalizeHashInput(line)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$6$") {
		t.Fatalf("want $6$ prefix, got %q", h)
	}
}

func TestVerifyRoundTrip(t *testing.T) {
	c := crypt.New(crypt.SHA512)
	hashed, err := c.Generate([]byte("correct-horse"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if Verify(hashed, "correct-horse") != nil {
		t.Fatal("expected match")
	}
	if Verify(hashed, "wrong") == nil {
		t.Fatal("expected mismatch")
	}
}
