package assetlist

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"testing"

	"github.com/cavaliergopher/grab/v3"
	"github.com/stretchr/testify/require"
)

func TestType(t *testing.T) {
	resp, err := grab.Get(".", "https://raw.githubusercontent.com/osmosis-labs/assetlists/main/osmosis-1/osmosis-1.assetlist.json")
	require.NoError(t, err)

	content, err := ioutil.ReadFile(resp.Filename) // the file is inside the local directory
	if err != nil {
		fmt.Println("Err")
	}
	var root Root
	err = json.Unmarshal(content, &root)
	require.NoError(t, err)
	require.Equal(t, "osmosis", root.ChainName)
}
