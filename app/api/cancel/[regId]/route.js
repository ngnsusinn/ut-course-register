// app/api/cancel/[regId]/route.js
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
    cache: 'no-store'
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

export async function DELETE(request, { params }) {
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

    // Validate regId
    const { regId } = params;
    if (!regId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Registration ID is required" 
        }), 
        { status: 400 }
      );
    }

    const baseUrl = "https://portal.ut.edu.vn/api/v1/dkhp";
    const data = await makeRequest(
      `${baseUrl}/huyDangKy?idDangKy=${encodeURIComponent(regId)}`,
      token,
      "DELETE"
    );

    if (!data || !data.success) {
      throw new Error(data?.message || "Failed to cancel registration");
    }

    return Response.json({
      success: true,
      message: "Registration cancelled successfully"
    });

  } catch (error) {
    console.error("Cancellation error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || "Failed to cancel registration" 
      }), 
      { status: error.status || 500 }
    );
  }
}