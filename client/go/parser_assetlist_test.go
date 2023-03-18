package assetlist

import "testing"

func TestGetDenomBySymbol(t *testing.T) {
	type testcase struct {
		Symbol        string
		ExpectedDenom string
	}
	testcases := []testcase{
		{"OSMO", "uosmo"},
		{"ATOM", "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2"},
	}
	for _, tc := range testcases {
		denom, err := GetDenomBySymbol(tc.Symbol)
		if err != nil {
			panic(err)
		}
		if denom != tc.ExpectedDenom {
			t.Errorf("Expected %s, got %s", tc.ExpectedDenom, denom)
		}
	}
}

func TestGetSymbolByDenom(t *testing.T) {
	type testcase struct {
		Denom          string
		ExpectedSymbol string
	}
	testcases := []testcase{
		{"uosmo", "OSMO"},
		{"ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2", "ATOM"},
	}
	for _, tc := range testcases {
		denom, err := GetSymbolByDenom(tc.Denom)
		if err != nil {
			panic(err)
		}
		if denom != tc.ExpectedSymbol {
			t.Errorf("Expected %s, got %s", tc.ExpectedSymbol, denom)
		}
	}
}
