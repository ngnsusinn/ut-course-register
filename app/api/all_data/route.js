// app/api/all_data/route.js
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

    // Validate dot_id
    const { searchParams } = new URL(request.url);
    const dotId = searchParams.get("dot_id");
    if (!dotId || isNaN(Number(dotId))) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Invalid or missing dot_id parameter" 
        }), 
        { status: 400 }
      );
    }

    const baseUrl = "https://portal.ut.edu.vn/api/v1/dkhp";

    // Fetch subjects
    const subjectsData = await makeRequest(
      `${baseUrl}/getHocPhanHocMoi?idDot=${encodeURIComponent(dotId)}`, 
      token
    );

    if (!subjectsData || !subjectsData.success) {
      throw new Error(subjectsData?.message || "Failed to fetch subjects");
    }

    const subjects = subjectsData.body || [];

    // Process subjects in chunks to avoid overwhelming the server
    const chunkSize = 5;
    const results = [];

    for (let i = 0; i < subjects.length; i += chunkSize) {
      const chunk = subjects.slice(i, i + chunkSize);
      
      const chunkData = await Promise.all(
        chunk.map(async (subject) => {
          try {
            const subjectCode = subject.maHocPhan;
            const classesData = await makeRequest(
              `${baseUrl}/getLopHocPhanChoDangKy?idDot=${encodeURIComponent(dotId)}&maHocPhan=${encodeURIComponent(subjectCode)}&isLocTrung=False&isLocTrungWithoutElearning=false`,
              token
            );

            if (!classesData.success) {
              console.warn(`Failed to fetch classes for subject ${subjectCode}`);
              return [];
            }

            const classes = classesData.body || [];
            
            const details = await Promise.all(
              classes.map(async (cls) => {
                try {
                  const detailsData = await makeRequest(
                    `${baseUrl}/getLopHocPhanDetail?idLopHocPhan=${encodeURIComponent(cls.id)}`,
                    token
                  );
                  return {
                    subject,
                    class: cls,
                    schedules: detailsData.body || []
                  };
                } catch (error) {
                  console.warn(`Failed to fetch details for class ${cls.id}:`, error);
                  return {
                    subject,
                    class: cls,
                    schedules: []
                  };
                }
              })
            );

            return details;
          } catch (error) {
            console.warn(`Error processing subject ${subject.maHocPhan}:`, error);
            return [];
          }
        })
      );

      results.push(...chunkData.flat());
    }

    return Response.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error("Error fetching all data:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || "Failed to fetch course data" 
      }), 
      { status: error.status || 500 }
    );
  }
}