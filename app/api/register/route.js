// app/api/register/route.js
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

async function registerClass(token, classId) {
  if (!classId) {
    throw new Error("Class ID is required");
  }

  const url = `https://portal.ut.edu.vn/api/v1/dkhp/dangKyLopHocPhan?idLopHocPhan=${encodeURIComponent(classId)}`;
  
  try {
    const data = await makeRequest(url, token, "POST");
    return {
      success: data.success,
      message: data.message || "Registration successful"
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Registration failed"
    };
  }
}

export async function POST(request) {
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

    // Validate request body
    if (!request.body) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Request body is required" 
        }), 
        { status: 400 }
      );
    }

    const { class_ids } = await request.json();

    // Validate class_ids
    if (!Array.isArray(class_ids) || class_ids.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "class_ids must be a non-empty array" 
        }), 
        { status: 400 }
      );
    }

    // Register classes in parallel for better performance
    const registrationResults = await Promise.all(
      class_ids.map(async (cid) => {
        const result = await registerClass(token, cid);
        return [cid, result];
      })
    );

    // Convert results to object
    const results = Object.fromEntries(registrationResults);

    return Response.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error("Registration error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || "Registration failed" 
      }), 
      { status: error.status || 500 }
    );
  }
}