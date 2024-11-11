
export async function queryApi(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`Error fetching data: ${response.statusText}`);
      return response.statusText;
    }
    const data = await response.json();
    console.log("Successfully fetched API Data.");
    return data;
  } catch (error) {
    console.log('Error fetching data:', error);
    return;
  }
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}