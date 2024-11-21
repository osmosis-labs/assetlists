import json

# Paths to the JSON files
zone_assets_file = "../../../osmosis-1/generated/frontend/assetlist.json"
state_file = "../../../osmosis-1/generated/state/state.json"

def process_assets(zone_assets_file, state_file):
    try:
        # Load the zone_assets.json file
        with open(zone_assets_file, 'r') as f:
            zone_assets_data = json.load(f)

        # Ensure the structure is as expected
        if "assets" not in zone_assets_data or not isinstance(zone_assets_data["assets"], list):
            raise ValueError("zone_assets.json has an invalid structure.")
        
        # Process the assets
        processed_assets = []
        for asset in zone_assets_data["assets"]:
            if asset.get("verified") is True:

                processed_asset = {}

                # Add coinMinimalDenom if present
                if "coinMinimalDenom" in asset:
                    processed_asset["base_denom"] = asset["coinMinimalDenom"]

                # Add listingDate or legacyAsset based on listing_date_time_utc
                if "listingDate" in asset:
                    processed_asset["listingDate"] = asset["listingDate"]
                else:
                    processed_asset["legacyAsset"] = True

                # Add the processed asset to the list
                processed_assets.append(processed_asset)


        # Create the state.json structure
        state_data = {"assets": processed_assets}

        # Save to state.json
        with open(state_file, 'w') as f:
            json.dump(state_data, f, indent=2)

        print(f"Successfully processed assets and saved to {state_file}")

    except FileNotFoundError as e:
        print(f"File not found: {e.filename}")
    except ValueError as e:
        print(f"ValueError: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

# Run the function
process_assets(zone_assets_file, state_file)
