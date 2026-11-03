package aegisbench

import "testing"

func TestApplyDiscount(t *testing.T) {
	if got := ApplyDiscount(100, 0.10); got != 90 {
		t.Fatalf("ApplyDiscount(100, 0.10) = %v; want 90", got)
	}
}
