// app/api/registered/route.js
async function makeRequest(url, token, method = "GET", body = null) {
  if (!url || !token) {
    throw new Error("URL and token are required");
  }

  const options = {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
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
        JSON.stringify({ error: "Invalid authorization header format" }), 
        { status: 401 }
      );
    }
    const token = authHeader.split(" ")[1];
    
    // Validate dot_id parameter
    const { searchParams } = new URL(request.url);
    const dotId = searchParams.get("dot_id");
    if (!dotId || isNaN(Number(dotId))) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing dot_id parameter" }), 
        { status: 400 }
      );
    }

    const baseUrl = "https://portal.ut.edu.vn/api/v1/dkhp";
    const data = await makeRequest(
      `${baseUrl}/getLHPDaDangKy?idDot=${dotId}`, 
      token
    );

    if (!data || !data.success) {
      throw new Error(data?.message || "Failed to fetch registered courses");
    }

    return Response.json({
      success: true,
      data: data.body || []
    });

  } catch (error) {
    console.error("Error in GET /api/registered:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || "Internal server error" 
      }), 
      { status: error.status || 500 }
    );
  }
}