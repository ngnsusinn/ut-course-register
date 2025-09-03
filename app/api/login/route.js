// app/api/login/route.js
export async function POST(request) {
  try {
    // Validate request body
    if (!request.body) {
      return new Response(
        JSON.stringify({ success: false, error: "Request body is required" }), 
        { status: 400 }
      );
    }

    const { username, password } = await request.json();
    
    // Validate credentials
    if (!username || !password) {
      return new Response(
        JSON.stringify({ success: false, error: "Username and password are required" }), 
        { status: 400 }
      );
    }

    // URL encode parameters
    const encodedUsername = encodeURIComponent(username);
    const encodedPassword = encodeURIComponent(password);
    const apiUrl = `https://api.ngnsusinn.io.vn/get_token_uth.php?username=${encodedUsername}&password=${encodedPassword}`;

    const resp = await fetch(apiUrl, { 
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data = await resp.json();
    
    if (!data.token) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Invalid credentials" 
        }), 
        { status: 401 }
      );
    }

    return Response.json({ 
      success: true, 
      token: data.token 
    });

  } catch (error) {
    console.error("Login error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "Authentication failed. Please try again later." 
      }), 
      { status: 500 }
    );
  }
}