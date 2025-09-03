// app/api/dots/route.js
async function makeRequest(url, token, method = "GET", body = null) {
  if (!url || !token) {
    throw new Error("URL and token are required");
  }

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };

  const options = { 
    method, 
    headers,
    cache: 'no-store' // Disable caching for fresh data
  };

  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

export async function GET(request) {
  try {
    // Validate token
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Invalid authorization header format" 
        }), 
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    const baseUrl = "https://portal.ut.edu.vn/api/v1/dkhp";

    const data = await makeRequest(`${baseUrl}/getDot`, token);

    if (!data || !data.success) {
      throw new Error(data?.message || "Failed to fetch registration periods");
    }

    return Response.json({
      success: true,
      data: data.body || []
    });

  } catch (error) {
    console.error("Error fetching dots:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || "Failed to fetch registration periods" 
      }), 
      { status: error.status || 500 }
    );
  }
}